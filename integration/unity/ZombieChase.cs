using UnityEngine;
using UnityEngine.AI;
using System.Collections;

[RequireComponent(typeof(NavMeshAgent))]
public class ZombieChase : MonoBehaviour
{
    [Header("Detection")]
    [Tooltip("Player must be within this distance for the zombie to notice and start " +
             "chasing. Beyond it, the zombie stays idle (Speed = 0). Ignored once crawling " +
             "-- a crawling zombie always keeps hunting regardless of distance.")]
    public float detectionRange = 8f;

    [Header("Chase")]
    public Transform player;
    public float stopDistance = 1.2f;
    public float repathInterval = 0.2f;
    public float attackCooldown = 1.5f;

    [Header("Attack Damage")]
    [Tooltip("Player's health component. Damage is applied the same frame the Attack " +
             "trigger fires.")]
    public PlayerHealth playerHealth;
    public float attackDamage = 12f;

    [Header("Audio")]
    public ZombieAudio zombieAudio;

    [Header("Blood")]
    public BloodEffects bloodEffects;

    [Header("Physical Separation")]
    [Tooltip("Movement here is driven by animation root motion, which bypasses physics " +
             "entirely -- a Collider on the zombie alone will stop the PLAYER walking into " +
             "it (CharacterController collides normally), but nothing stops the zombie's " +
             "root-motion-driven position from walking into the player. This clamps that " +
             "distance every frame instead.")]
    public float minSeparationDistance = 0.65f;

    [Header("Wall Collision")]
    [Tooltip("Same root-motion problem as above, but against walls/level geometry instead " +
             "of the player: nothing stops root motion from walking straight through a wall " +
             "collider, so this checks for solid geometry at the candidate position each " +
             "frame and rejects the move if blocked. Self and player colliders are excluded " +
             "by identity, not by layer, so the default of Everything is safe to leave as-is.")]
    public LayerMask wallLayers = ~0;
    public float wallCheckRadius = 0.3f;
    public float wallCheckHeight = 0.9f;

    [Header("Death -> Crawl")]
    [Tooltip("Delay after death before the headless crawl phase begins")]
    public float crawlDelayAfterDeath = 5f;
    [Tooltip("Movement speed while crawling, headless")]
    public float crawlSpeed = 0.3f;
    [Tooltip("Tag on the crawl animation State in the Animator Controller (State Inspector -> Tag " +
             "field). Used to confirm the Animator has actually entered the crawl pose before we " +
             "hand rotation/movement control to the NavMeshAgent — otherwise the agent starts " +
             "turning the zombie toward the player the instant the bool is set, one or more frames " +
             "before the crawl animation itself visibly starts.")]
    public string crawlAnimatorStateTag = "Crawl";
    [Tooltip("Safety cap in seconds on how long to wait for the crawl state tag to appear before " +
             "giving up and starting crawl movement anyway (in case the tag isn't set up).")]
    public float maxCrawlTransitionWait = 1.5f;
    [Tooltip("Once the Animator confirms it's in the crawl state, wait for the clip to actually play " +
             "forward by this fraction (0-1) before handing rotation/movement to the NavMeshAgent. " +
             "Many mocap clips have a brief 'wind-up' in their first few frames that still visually " +
             "resembles the previous pose, so IsTag alone can fire a beat before it LOOKS like " +
             "crawling — this adds a small buffer so rotation lines up with what you actually see.")]
    [Range(0f, 0.3f)]
    public float crawlPoseSettleFraction = 0.08f;

    private NavMeshAgent agent;
    private Animator animator;
    private float repathTimer;
    private float attackTimer;
    private bool isDead = false;
    private bool isCrawling = false;
    private bool isFrozen = false; // true the moment the head is grabbed, before the actual tear/Die()

    void Start()
    {
        agent = GetComponent<NavMeshAgent>();
        animator = GetComponentInChildren<Animator>();
        agent.stoppingDistance = stopDistance;

        agent.updatePosition = false;
        agent.updateRotation = false;
    }

    void Update()
    {
        if ((isDead && !isCrawling) || isFrozen || player == null) return;

        // Distance gate: stay idle until the player is close enough to notice.
        // A crawling zombie skips this check and always keeps hunting.
        if (!isCrawling)
        {
            float distanceToPlayer = Vector3.Distance(transform.position, player.position);
            if (distanceToPlayer > detectionRange)
            {
                if (animator != null) animator.SetFloat("Speed", 0f);
                agent.ResetPath();
                return;
            }
        }

        repathTimer -= Time.deltaTime;
        if (repathTimer <= 0f)
        {
            agent.SetDestination(player.position);
            repathTimer = repathInterval;
        }

        if (animator != null)
        {
            float speedNormalized = agent.desiredVelocity.magnitude / Mathf.Max(agent.speed, 0.01f);
            animator.SetFloat("Speed", speedNormalized);
        }

        if (!isCrawling && agent.desiredVelocity.sqrMagnitude > 0.001f)
        {
            Quaternion targetRot = Quaternion.LookRotation(agent.desiredVelocity.normalized);
            transform.rotation = Quaternion.RotateTowards(transform.rotation, targetRot, 180f * Time.deltaTime);
        }

        if (!isCrawling && !agent.pathPending && agent.remainingDistance <= agent.stoppingDistance)
        {
            attackTimer -= Time.deltaTime;
            if (attackTimer <= 0f)
            {
                if (animator != null) animator.SetTrigger("Attack");
                if (zombieAudio != null) zombieAudio.PlayAttack();
                if (playerHealth != null) playerHealth.TakeDamage(attackDamage);
                attackTimer = attackCooldown;
            }
        }
    }

    void OnAnimatorMove()
    {
        if (animator == null) return;
        if (isDead && !isCrawling) return;
        if (isCrawling) return;

        Vector3 rootMotionPos = animator.rootPosition;

        if (player != null)
        {
            Vector3 flatOffset = rootMotionPos - player.position;
            flatOffset.y = 0f;
            float flatDist = flatOffset.magnitude;
            if (flatDist < minSeparationDistance && flatDist > 0.0001f)
            {
                Vector3 pushedFlat = flatOffset.normalized * minSeparationDistance;
                rootMotionPos.x = player.position.x + pushedFlat.x;
                rootMotionPos.z = player.position.z + pushedFlat.z;
            }
        }

        Vector3 checkCenter = rootMotionPos + Vector3.up * wallCheckHeight;
        Collider[] hits = Physics.OverlapSphere(checkCenter, wallCheckRadius, wallLayers, QueryTriggerInteraction.Ignore);
        bool blockedByWall = false;
        foreach (Collider hit in hits)
        {
            if (hit.transform == transform || hit.transform.IsChildOf(transform)) continue;
            if (player != null && (hit.transform == player || hit.transform.IsChildOf(player))) continue;
            blockedByWall = true;
            break;
        }
        if (blockedByWall)
        {
            rootMotionPos = transform.position;
        }

        agent.nextPosition = rootMotionPos;
        transform.position = rootMotionPos;
    }

    public void Freeze()
    {
        if (isFrozen || isDead) return;
        isFrozen = true;

        agent.isStopped = true;
        agent.updatePosition = false;
        agent.updateRotation = false;
    }

    public void Die()
    {
        if (isDead) return;
        isDead = true;
        isFrozen = false;

        agent.isStopped = true;
        agent.updatePosition = false;

        if (animator != null)
            animator.SetTrigger("Die");

        if (zombieAudio != null)
            zombieAudio.PlayDeathOrTear();

        if (bloodEffects != null)
            bloodEffects.PlayTearEffects();

        StartCoroutine(BeginCrawlAfterDelay());
    }

    private IEnumerator BeginCrawlAfterDelay()
    {
        yield return new WaitForSeconds(crawlDelayAfterDeath);

        if (animator != null)
            animator.SetBool("IsCrawling", true);

        if (animator != null && !string.IsNullOrEmpty(crawlAnimatorStateTag))
        {
            float waitStart = Time.time;
            while (!animator.GetCurrentAnimatorStateInfo(0).IsTag(crawlAnimatorStateTag)
                   && Time.time - waitStart < maxCrawlTransitionWait)
            {
                yield return null;
            }

            if (!animator.GetCurrentAnimatorStateInfo(0).IsTag(crawlAnimatorStateTag))
            {
                Debug.LogWarning($"[ZombieChase] Gave up waiting for Animator state tagged " +
                                  $"'{crawlAnimatorStateTag}' after {maxCrawlTransitionWait}s — starting " +
                                  $"crawl movement anyway. Check that the crawl State in the Animator " +
                                  $"Controller actually has this tag set (State Inspector -> Tag field).");
            }
            else if (crawlPoseSettleFraction > 0f)
            {
                float startNormalizedTime = animator.GetCurrentAnimatorStateInfo(0).normalizedTime;
                float settleWaitStart = Time.time;
                while (animator.GetCurrentAnimatorStateInfo(0).normalizedTime - startNormalizedTime < crawlPoseSettleFraction
                       && Time.time - settleWaitStart < maxCrawlTransitionWait)
                {
                    yield return null;
                }
            }
        }

        isCrawling = true;
        isDead = false;
        agent.Warp(transform.position);

        if (zombieAudio != null)
            zombieAudio.StartCrawlGroaning();

        agent.speed = crawlSpeed;
        agent.stoppingDistance = 0.6f;
        agent.isStopped = false;
        agent.updatePosition = true;
        agent.updateRotation = true;

        Debug.Log($"[ZombieChase] Crawl started | isOnNavMesh: {agent.isOnNavMesh} | " +
                  $"speed: {agent.speed} | destination: {agent.destination}");
    }
}
