using UnityEngine;
using System.Collections;

/// <summary>
/// Blood VFX for the head-tear moment: a particle burst spray, a short
/// continuous drip afterward, and a floor decal that grows from nothing
/// into a full pool over a few seconds. Attach to the zombie (or a child
/// near the neck). Assign the spray/drip ParticleSystems and the pool's
/// Transform in the Inspector.
///
/// Kept deliberately lightweight for standalone Quest: no particle
/// collision, no particle shadows, low particle counts. The pool is a
/// single quad with a soft-edged texture, not a runtime decal projector.
/// </summary>
public class BloodEffects : MonoBehaviour
{
    [Header("Spray (burst at the moment of the tear)")]
    public ParticleSystem sprayParticles;
    [Range(5, 60)] public int sprayBurstCount = 25;

    [Header("Drip (short continuous emission afterward)")]
    public ParticleSystem dripParticles;
    public float dripDuration = 8f;

    [Header("Blood Pool (floor decal that grows in)")]
    [Tooltip("Transform of the pool quad. Starts scaled to zero and grows to poolMaxScale.")]
    public Transform bloodPool;
    public float poolGrowDuration = 4f;
    public Vector3 poolMaxScale = new Vector3(1.2f, 1f, 1.2f);

    private Coroutine growPoolRoutine;

    void Awake()
    {
        if (bloodPool != null)
            bloodPool.localScale = Vector3.zero;
    }

    /// <summary>Call once from ZombieChase.Die(), right when the head comes off.</summary>
    public void PlayTearEffects()
    {
        if (sprayParticles != null)
        {
            ParticleSystem.Burst burst = new ParticleSystem.Burst(0f, (short)sprayBurstCount);
            ParticleSystem.EmissionModule emission = sprayParticles.emission;
            emission.SetBurst(0, burst);
            sprayParticles.Play();
        }

        if (dripParticles != null)
        {
            dripParticles.Play();
            StartCoroutine(StopDripAfter(dripDuration));
        }

        if (bloodPool != null)
        {
            // Snap the pool to the zombie's current ground position (XZ only --
            // keep the pool's own configured Y so it stays flush with the floor)
            // before growing it in. Without this, a pool parented under the
            // zombie would crawl away with it after the death-to-crawl delay.
            Vector3 snapPos = bloodPool.position;
            snapPos.x = transform.position.x;
            snapPos.z = transform.position.z;
            bloodPool.position = snapPos;

            if (growPoolRoutine != null) StopCoroutine(growPoolRoutine);
            growPoolRoutine = StartCoroutine(GrowPool());
        }
    }

    private IEnumerator StopDripAfter(float seconds)
    {
        yield return new WaitForSeconds(seconds);
        if (dripParticles != null)
            dripParticles.Stop();
    }

    private IEnumerator GrowPool()
    {
        float t = 0f;
        while (t < poolGrowDuration)
        {
            t += Time.deltaTime;
            float frac = Mathf.SmoothStep(0f, 1f, t / poolGrowDuration);
            bloodPool.localScale = Vector3.Lerp(Vector3.zero, poolMaxScale, frac);
            yield return null;
        }
        bloodPool.localScale = poolMaxScale;
    }
}
