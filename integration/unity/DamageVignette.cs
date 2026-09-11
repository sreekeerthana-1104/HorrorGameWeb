using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

/// <summary>
/// Drives the URP Vignette override on this GameObject's Volume based on
/// PlayerHealth: a subtle baseline that grows as health drops, plus a sharp
/// pulse on every hit. This is the health "UI" for this game by design —
/// no floating bar, no numbers. Attach to your existing Global Volume object
/// (the one already referencing SampleSceneProfile).
/// </summary>
[RequireComponent(typeof(Volume))]
public class DamageVignette : MonoBehaviour
{
    [Header("References")]
    public PlayerHealth playerHealth;

    [Header("Baseline vignette by health")]
    [Tooltip("Vignette intensity at full health. Keep low/subtle.")]
    [Range(0f, 1f)] public float minIntensity = 0.15f;
    [Tooltip("Vignette intensity at zero health.")]
    [Range(0f, 1f)] public float maxIntensity = 0.55f;
    public Color vignetteColor = new Color(0.45f, 0.02f, 0.02f);

    [Header("Hit pulse")]
    [Tooltip("How much intensity spikes the instant damage is taken.")]
    public float pulseAddIntensity = 0.35f;
    [Tooltip("How fast the pulse fades back to baseline, in intensity/second.")]
    public float pulseDecaySpeed = 1.5f;

    private Volume volume;
    private Vignette vignette;
    private float pulse;
    private float lastHealthFraction = 1f;

    void Awake()
    {
        volume = GetComponent<Volume>();
        if (volume.profile == null)
        {
            Debug.LogError("[DamageVignette] Volume on this GameObject has no profile assigned.");
            enabled = false;
            return;
        }

        if (!volume.profile.TryGet(out vignette))
        {
            vignette = volume.profile.Add<Vignette>(true);
        }

        vignette.color.overrideState = true;
        vignette.color.value = vignetteColor;
        vignette.intensity.overrideState = true;
        vignette.smoothness.overrideState = true;
        vignette.smoothness.value = 0.6f;
    }

    void OnEnable()
    {
        if (playerHealth != null)
            playerHealth.OnHealthChanged += HandleHealthChanged;
    }

    void OnDisable()
    {
        if (playerHealth != null)
            playerHealth.OnHealthChanged -= HandleHealthChanged;
    }

    void HandleHealthChanged(float current, float max)
    {
        float frac = max > 0f ? current / max : 1f;
        if (frac < lastHealthFraction)
            pulse = pulseAddIntensity;
        lastHealthFraction = frac;
    }

    void Update()
    {
        if (playerHealth == null || vignette == null) return;

        pulse = Mathf.MoveTowards(pulse, 0f, pulseDecaySpeed * Time.deltaTime);
        float baseline = Mathf.Lerp(minIntensity, maxIntensity, 1f - playerHealth.HealthFraction);
        vignette.intensity.value = Mathf.Clamp01(baseline + pulse);
    }
}
