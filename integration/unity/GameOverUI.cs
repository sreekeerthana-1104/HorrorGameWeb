using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// Listens for PlayerHealth.OnDeath and shows the game over panel.
/// Attach to the GameOverCanvas root. Assign the panel GameObject
/// (children of the canvas holding the "YOU DIED" text + restart button)
/// in the Inspector, and wire the restart button's OnClick to Restart().
/// </summary>
public class GameOverUI : MonoBehaviour
{
    [Header("References")]
    public PlayerHealth playerHealth;
    public GameObject panelRoot;

    [Header("Restart")]
    [Tooltip("If empty, reloads the currently active scene.")]
    public string sceneNameToLoad = "";

    void Awake()
    {
        if (panelRoot != null)
            panelRoot.SetActive(false);
    }

    void OnEnable()
    {
        if (playerHealth != null)
            playerHealth.OnDeath += HandleDeath;
    }

    void OnDisable()
    {
        if (playerHealth != null)
            playerHealth.OnDeath -= HandleDeath;
    }

    private void HandleDeath()
    {
        if (panelRoot != null)
            panelRoot.SetActive(true);
    }

    /// <summary>Wire this to the restart button's OnClick in the Inspector.</summary>
    public void Restart()
    {
        string target = string.IsNullOrEmpty(sceneNameToLoad)
            ? SceneManager.GetActiveScene().name
            : sceneNameToLoad;
        SceneManager.LoadScene(target);
    }
}
