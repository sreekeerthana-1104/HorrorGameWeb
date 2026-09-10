using UnityEngine;
using UnityEngine.AI;
using System.Collections;

[RequireComponent(typeof(NavMeshAgent))]
public class ZombieChase : MonoBehaviour
{
    [Header("Chase")]
    public Transform player;
    public float stopDistance = 1.2f;
    public float repathInterval = 0.2f;
    public float attackCooldown = 1.5f;

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

        agent.speed = crawlSpeed;
        agent.stoppingDistance = 0.6f;
        agent.isStopped = false;
        agent.updatePosition = true; 
        agent.updateRotation = true; 

        Debug.Log($"[ZombieChase] Crawl started | isOnNavMesh: {agent.isOnNavMesh} | " +
                  $"speed: {agent.speed} | destination: {agent.destination}");
    }
}