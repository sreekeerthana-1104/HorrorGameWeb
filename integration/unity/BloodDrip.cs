using UnityEngine;

public class BloodDrip : MonoBehaviour
{
    [Header("Continuous drip particles")]
    [Tooltip("Small particle system, child of this object, aimed downward. Leave unassigned if you " +
             "only want the ground pool with no falling-droplet VFX.")]
    public ParticleSystem dripParticles;

    [Header("Ground pool")]
    [Tooltip("Prefab for the puddle/splat effect. Two very different kinds of asset work here — see " +
             "Spawn Fresh Splat Each Drop below for which mode fits which kind.")]
    public GameObject poolPrefab;

    [Tooltip("ON (default): treat Pool Prefab as a ONE-SHOT effect (e.g. Vefects' VFX_Splat_* particle " +
             "bursts — Duration 1, Looping off) and spawn a fresh small instance at every drop, letting " +
             "them overlap near each other to build up a pool naturally. Required for burst particle " +
             "systems, since they don't rescale correctly once they've already finished playing.\n\n" +
             "OFF: treat Pool Prefab as a simple STATIC decal (a plain quad/mesh) and grow ONE persistent " +
             "instance's scale over time instead — cheaper, but only looks right on non-particle prefabs.")]
    public bool spawnFreshSplatEachDrop = true;

    [Tooltip("Only used when Spawn Fresh Splat Each Drop is ON. Hard cap on how many splat instances " +
             "this BloodDrip will spawn in total, so a long chase doesn't quietly spawn hundreds of them.")]
    public int maxSplatInstances = 25;

    [Tooltip("Only used when Spawn Fresh Splat Each Drop is ON. Random scale range applied to each fresh " +
             "splat instance so they don't all look identically sized.")]
    public Vector2 splatScaleRange = new Vector2(0.5f, 0.9f);

    [Tooltip("Only surfaces on this layer count as ground the blood can pool on.")]
    public LayerMask groundLayerMask = ~0;

    [Tooltip("How far below the drip point to check for ground. If the stump is higher than this " +
             "above any surface, blood is considered to disperse in the air instead of pooling.")]
    public float maxDropHeight = 2.5f;

    [Range(0.1f, 2f)]
    [Tooltip("Seconds between drops, min/max randomized per drop so it doesn't tick like a metronome.")]
    public float dropIntervalMin = 0.35f;
    public float dropIntervalMax = 0.75f;

    [Header("Grow-one-decal mode only (Spawn Fresh Splat Each Drop = OFF)")]
    [Tooltip("How much a pool's radius (localScale) grows per drop.")]
    public float poolGrowPerDrop = 0.035f;

    [Tooltip("Cap on pool radius (localScale) — stops it growing forever.")]
    public float poolMaxScale = 0.9f;

    [Tooltip("If the drip point has moved further than this (measured flat, XZ) from the current " +
             "pool's spot, start a NEW pool there instead of continuing to grow the old one — this " +
             "is what makes a trail of separate stains when you walk around holding the head.")]
    public float newPoolMoveThreshold = 0.3f;

    [Tooltip("Starting scale for a freshly spawned pool decal, before any growth is applied.")]
    public float poolStartScale = 0.15f;

    private bool isDripping = false;
    private float dropTimer;
    private Transform currentPool;
    private int splatsSpawned = 0;

    public void StartDripping()
    {
        if (isDripping) return;
        isDripping = true;
        dropTimer = Random.Range(dropIntervalMin, dropIntervalMax);

        Debug.Log($"[BloodDrip] StartDripping on '{gameObject.name}' | dripParticles: " +
                  $"{(dripParticles != null ? dripParticles.name : "NULL")} | poolPrefab: " +
                  $"{(poolPrefab != null ? poolPrefab.name : "NULL")}");

        if (dripParticles != null)
        {

            if (!dripParticles.gameObject.activeSelf)
            {
                dripParticles.gameObject.SetActive(true);
                Debug.Log("[BloodDrip] Drip Particles' GameObject was inactive — activated it.");
            }
            if (!dripParticles.isPlaying) dripParticles.Play();
        }
    }

    public void StopDripping()
    {
        isDripping = false;
        if (dripParticles != null) dripParticles.Stop();
    }

    void Update()
    {
        if (!isDripping || poolPrefab == null) return;

        dropTimer -= Time.deltaTime;
        if (dropTimer <= 0f)
        {
            dropTimer = Random.Range(dropIntervalMin, dropIntervalMax);
            TryDrop();
        }
    }

    private void TryDrop()
    {

        RaycastHit[] hits = Physics.RaycastAll(transform.position, Vector3.down, maxDropHeight, groundLayerMask,
                                                QueryTriggerInteraction.Ignore);

        RaycastHit? closest = null;
        foreach (RaycastHit h in hits)
        {
            if (h.transform == transform || h.transform.IsChildOf(transform)) continue; 
            if (closest == null || h.distance < closest.Value.distance) closest = h;
        }

        if (closest == null)
        {
            Debug.Log($"[BloodDrip] '{gameObject.name}': no ground found within {maxDropHeight}m " +
                      $"(checked {hits.Length} raw hit(s), all filtered as self or none at all) — " +
                      $"no pool this drop.");
            return;
        }

        RaycastHit hit = closest.Value;
        Debug.Log($"[BloodDrip] '{gameObject.name}': drop hit '{hit.collider.name}' " +
                  $"(layer {LayerMask.LayerToName(hit.collider.gameObject.layer)}) at {hit.point}.");

        if (spawnFreshSplatEachDrop)
        {
            if (splatsSpawned >= maxSplatInstances)
            {
                Debug.Log($"[BloodDrip] '{gameObject.name}': hit Max Splat Instances ({maxSplatInstances}) " +
                          $"— no more splats will spawn.");
                return;
            }
            SpawnFreshSplat(hit.point, hit.normal);
            return;
        }

        bool startNewPool = currentPool == null;
        if (!startNewPool)
        {
            Vector3 poolFlat = new Vector3(currentPool.position.x, 0f, currentPool.position.z);
            Vector3 hitFlat = new Vector3(hit.point.x, 0f, hit.point.z);
            startNewPool = Vector3.Distance(poolFlat, hitFlat) > newPoolMoveThreshold;
        }

        if (startNewPool)
        {
            SpawnPool(hit.point, hit.normal);
        }
        else
        {
            GrowPool(currentPool, hit.point);
        }
    }


    private void SpawnFreshSplat(Vector3 point, Vector3 normal)
    {
        GameObject splat = Instantiate(poolPrefab, point + normal * 0.01f, Quaternion.identity);
        splat.transform.rotation = Quaternion.FromToRotation(Vector3.up, normal)
                                    * Quaternion.Euler(0f, Random.Range(0f, 360f), 0f);
        float scale = Random.Range(splatScaleRange.x, splatScaleRange.y);
        splat.transform.localScale = Vector3.one * scale;
        splatsSpawned++;
        Debug.Log($"[BloodDrip] Spawned fresh splat '{splat.name}' ({splatsSpawned}/{maxSplatInstances}) " +
                  $"at {point}.");
    }

    private void SpawnPool(Vector3 point, Vector3 normal)
    {
        GameObject pool = Instantiate(poolPrefab, point + normal * 0.01f, Quaternion.identity);
        pool.transform.rotation = Quaternion.FromToRotation(Vector3.up, normal)
                                   * Quaternion.Euler(0f, Random.Range(0f, 360f), 0f); 
        pool.transform.localScale = Vector3.one * poolStartScale;
        currentPool = pool.transform;
        Debug.Log($"[BloodDrip] Spawned new pool '{pool.name}' at {point}.");
    }

    private void GrowPool(Transform pool, Vector3 latestPoint)
    {
        float newScale = Mathf.Min(pool.localScale.x + poolGrowPerDrop, poolMaxScale);
        pool.localScale = new Vector3(newScale, newScale, newScale);


        Vector3 target = new Vector3(latestPoint.x, pool.position.y, latestPoint.z);
        pool.position = Vector3.Lerp(pool.position, target, 0.15f);
    }
}