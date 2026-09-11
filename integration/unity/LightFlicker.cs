using System.Collections;
using UnityEngine;

/// <summary>
/// Fear engine's flicker_lights action. Drag the scene's existing tuned Point lights into
/// `lights` -- their baseline intensity is captured once at Start() and always restored
/// exactly after a flicker. This never permanently changes your lighting setup; it only
/// disrupts it briefly.
/// </summary>
public class LightFlicker : MonoBehaviour
{
    [Tooltip("The scene's tuned Point lights to disrupt.")]
    public Light[] lights;

    [Tooltip("Flicker duration in seconds at intensity = 1. Actual duration scales down with " +
             "a lower intensity passed to Flicker().")]
    [Range(0.2f, 3f)] public float baseDuration = 1.2f;

    [Tooltip("How low (as a fraction of the light's normal intensity) a flicker dip can go at " +
             "full intensity. 0 = can go fully dark, 1 = barely dims.")]
    [Range(0f, 1f)] public float minIntensityFraction = 0.05f;

    [Tooltip("Flicker steps per second at full intensity -- higher = more violent/strobing, " +
             "lower = a slower unsettling pulse.")]
    [Range(2f, 20f)] public float baseFlickerRate = 9f;

    private float[] originalIntensities;
    private bool isFlickering;

    void Start()
    {
        if (lights == null) return;
        originalIntensities = new float[lights.Length];
        for (int i = 0; i < lights.Length; i++)
            if (lights[i] != null) originalIntensities[i] = lights[i].intensity;
    }

    /// <summary>Fear engine's flicker_lights action. intensity (0-1) scales both how violent
    /// and how long the disruption is. Safe to call again mid-flicker -- it restarts with the
    /// new intensity rather than stacking.</summary>
    public void Flicker(float intensity = 1f)
    {
        if (lights == null || lights.Length == 0 || originalIntensities == null) return;
        intensity = Mathf.Clamp01(intensity);
        StopAllCoroutines();
        StartCoroutine(FlickerRoutine(intensity));
    }

    private IEnumerator FlickerRoutine(float intensity)
    {
        isFlickering = true;
        float duration = baseDuration * Mathf.Lerp(0.4f, 1f, intensity);
        float flickerRate = baseFlickerRate * Mathf.Lerp(0.5f, 1f, intensity);
        float minFraction = Mathf.Lerp(1f, minIntensityFraction, intensity);
        float elapsed = 0f;

        while (elapsed < duration)
        {
            float step = 1f / Mathf.Max(flickerRate, 0.1f);
            SetIntensityFraction(Random.Range(minFraction, 1f));
            float wait = step * Random.Range(0.4f, 1f);
            yield return new WaitForSeconds(wait);
            elapsed += step;
        }

        RestoreOriginal();
        isFlickering = false;
    }

    private void SetIntensityFraction(float fraction)
    {
        for (int i = 0; i < lights.Length; i++)
            if (lights[i] != null) lights[i].intensity = originalIntensities[i] * fraction;
    }

    private void RestoreOriginal()
    {
        for (int i = 0; i < lights.Length; i++)
            if (lights[i] != null) lights[i].intensity = originalIntensities[i];
    }

    void OnDisable()
    {
        if (isFlickering) RestoreOriginal();
    }
}
