using UnityEngine;

/// <summary>
/// Handles all zombie sound: one-shot stingers (footstep, attack, death/head-tear,
/// crawl groans) plus a continuous breathing/groan loop that gets louder as the
/// zombie nears the player purely from 3D spatialization -- no extra code needed
/// for that proximity-dread effect, just correct AudioSource distance settings.
///
/// Attach to the zombie root. Assign the two AudioSources (created for you) and
/// drag your actual clips into each array -- multiple clips per category so
/// PlayRandom() can vary them instead of repeating the same sound every time.
/// </summary>
public class ZombieAudio : MonoBehaviour
{
    [Header("Audio Sources")]
    [Tooltip("Plays one-shot stingers: footsteps, attacks, death/tear, crawl groans.")]
    public AudioSource voiceSource;
    [Tooltip("Continuous looping breathing/groan track. Gets louder as the zombie " +
             "approaches purely through 3D spatial falloff -- no code drives this, " +
             "just the AudioSource's Min/Max Distance settings.")]
    public AudioSource loopSource;

    [Header("Clips (drag several per category for variation)")]
    public AudioClip[] footstepClips;
    public AudioClip[] attackClips;
    public AudioClip[] deathOrTearClips;
    public AudioClip[] crawlGroanClips;
    public AudioClip breathingLoop;

    [Header("Variation")]
    [Tooltip("Random pitch offset applied on every one-shot play, +/- this fraction. " +
             "Keeps repeated sounds from feeling robotic.")]
    [Range(0f, 0.3f)] public float pitchVariance = 0.08f;

    [Header("Crawl groan pacing")]
    [Tooltip("Random interval range between groans while crawling.")]
    public Vector2 crawlGroanIntervalRange = new Vector2(2.5f, 5f);

    private float nextCrawlGroanTime;
    private bool crawlGroanActive;

    void Start()
    {
        if (loopSource != null && breathingLoop != null)
        {
            loopSource.clip = breathingLoop;
            loopSource.loop = true;
            loopSource.playOnAwake = false;
            loopSource.spatialBlend = 1f;
            loopSource.Play();
        }
    }

    void Update()
    {
        if (!crawlGroanActive) return;

        if (Time.time >= nextCrawlGroanTime)
        {
            PlayRandom(crawlGroanClips);
            ScheduleNextCrawlGroan();
        }
    }

    /// <summary>Call from an Animation Event on foot-plant frames of the Walk clip.</summary>
    public void PlayFootstep() => PlayRandom(footstepClips);

    /// <summary>Call alongside animator.SetTrigger("Attack") in ZombieChase.</summary>
    public void PlayAttack() => PlayRandom(attackClips);

    /// <summary>Call from ZombieChase.Die() -- covers the head-tear/death moment.</summary>
    public void PlayDeathOrTear() => PlayRandom(deathOrTearClips);

    /// <summary>Call once when crawl movement actually begins; starts periodic groaning.</summary>
    public void StartCrawlGroaning()
    {
        crawlGroanActive = true;
        ScheduleNextCrawlGroan();
    }

    private void ScheduleNextCrawlGroan()
    {
        nextCrawlGroanTime = Time.time + Random.Range(crawlGroanIntervalRange.x, crawlGroanIntervalRange.y);
    }

    private void PlayRandom(AudioClip[] clips)
    {
        if (clips == null || clips.Length == 0 || voiceSource == null) return;
        AudioClip clip = clips[Random.Range(0, clips.Length)];
        voiceSource.pitch = 1f + Random.Range(-pitchVariance, pitchVariance);
        voiceSource.PlayOneShot(clip);
    }
}
