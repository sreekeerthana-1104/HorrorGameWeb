using UnityEngine;
using System;

/// <summary>
/// Tracks player health, exposes damage/heal, and fires events other systems
/// (vignette, game over screen) react to. Attach to the player root
/// (PlayerController under Locomotor).
/// </summary>
public class PlayerHealth : MonoBehaviour
{
    [Header("Health")]
    public float maxHealth = 100f;
    public float currentHealth;

    [Header("Invulnerability")]
    [Tooltip("Seconds of immunity after taking a hit. Prevents multiple zombies " +
             "or repeated attack triggers from stacking damage in one instant.")]
    public float invulnerabilityDuration = 0.5f;

    /// <summary>Fired whenever health changes: (current, max).</summary>
    public event Action<float, float> OnHealthChanged;
    /// <summary>Fired once, the frame health reaches zero.</summary>
    public event Action OnDeath;

    private float invulnerableUntil = -1f;
    private bool isDead = false;

    public float HealthFraction => maxHealth > 0f ? currentHealth / maxHealth : 0f;
    public bool IsDead => isDead;

    void Awake()
    {
        currentHealth = maxHealth;
    }

    public void TakeDamage(float amount)
    {
        if (isDead || amount <= 0f) return;
        if (Time.time < invulnerableUntil) return;

        currentHealth = Mathf.Max(0f, currentHealth - amount);
        invulnerableUntil = Time.time + invulnerabilityDuration;
        OnHealthChanged?.Invoke(currentHealth, maxHealth);

        if (currentHealth <= 0f && !isDead)
        {
            isDead = true;
            OnDeath?.Invoke();
        }
    }

    public void Heal(float amount)
    {
        if (isDead || amount <= 0f) return;
        currentHealth = Mathf.Min(maxHealth, currentHealth + amount);
        OnHealthChanged?.Invoke(currentHealth, maxHealth);
    }

    /// <summary>Call from a restart/respawn flow to reset state.</summary>
    public void ResetHealth()
    {
        currentHealth = maxHealth;
        isDead = false;
        invulnerableUntil = -1f;
        OnHealthChanged?.Invoke(currentHealth, maxHealth);
    }
}
