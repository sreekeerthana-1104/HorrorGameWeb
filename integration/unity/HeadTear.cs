using System.Collections.Generic;
using UnityEngine;
using Oculus.Interaction;

public class HeadTear : MonoBehaviour
{
    [Tooltip("The real animated head bone (mixamorig5:Head). Tracked for position while attached, " +
             "scaled to zero to hide it the instant the head is torn off.")]
    public Transform headBone;

    [Tooltip("The zombie's SkinnedMeshRenderer (the 'Ch10' object). Used once, at tear-off, to cut " +
             "out a real head-shaped mesh from the current pose.")]
    public SkinnedMeshRenderer bodyRenderer;

    [Tooltip("How much of a vertex's total bone influence has to come from Head Bone for it to be " +
             "counted as part of the head. Raise this if the cut mesh includes shoulder/neck chunks, " +
             "lower it if the head comes out with holes.")]
    [Range(0f, 1f)]
    public float headWeightThreshold = 0.25f;

    [Tooltip("Meters. Vertices within this distance of Head Bone (in world space, at the pose the " +
             "mesh is baked in) also count as head, as long as they have at least SOME head bone " +
             "influence — even below Head Weight Threshold. This is a fallback for meshes with " +
             "imprecise/scattered auto-skinning, where weight alone doesn't produce a spatially " +
             "contiguous head region and no triangle ever has all 3 corners over threshold. " +
             "Set to 0 to disable and use weight-only selection like before.")]
    public float headProximityRadius = 0.18f;

    [Tooltip("Minimum head bone influence a vertex still needs even within Head Proximity Radius, " +
             "to avoid pulling in nearby collar/shoulder geometry that has literally zero head weight.")]
    [Range(0f, 1f)]
    public float headProximityMinWeight = 0.02f;

    [Tooltip("Scene-level EMG bridge. A calibrated BioAmp squeeze is required before this head can tear.")]
    public EmgTearGate emgTearGate;

    private Rigidbody rb;
    private Grabbable grabbable;
    private bool isTorn = false;
    private bool isHeldAfterTear = false;
    private bool loggedWaitingForEmg = false;
    private ZombieChase cachedChase;
    private BloodDrip bloodDrip;

    void Start()
    {
        rb = GetComponent<Rigidbody>();
        grabbable = GetComponent<Grabbable>();
        cachedChase = GetComponentInParent<ZombieChase>();
        bloodDrip = GetComponent<BloodDrip>();

        if (rb != null) rb.isKinematic = true;

        Debug.Log($"[HeadTear] INIT on '{gameObject.name}' | Grabbable: {grabbable != null} | " +
                  $"Rigidbody: {rb != null} | HeadBone: {(headBone != null ? headBone.name : "NULL")} | " +
                  $"BodyRenderer: {bodyRenderer != null} | ChaseFound: {cachedChase != null}");
    }

    void Update()
    {
        if (!isTorn)
        {
            bool isBeingGrabbed = grabbable != null && grabbable.SelectingPointsCount > 0;
            if (isBeingGrabbed && emgTearGate != null && emgTearGate.CanTear)
            {
                Debug.Log("[HeadTear] Grab + EMG squeeze detected -> tearing off.");
                TearOff();
            }
            else if (isBeingGrabbed && emgTearGate != null && !emgTearGate.CanTear && !loggedWaitingForEmg)
            {
                loggedWaitingForEmg = true;
                Debug.Log("[HeadTear] Grab was detected, but the two-second EMG tear window is currently closed.");
            }
            else if (!isBeingGrabbed)
            {
                loggedWaitingForEmg = false;
            }
            else if (isBeingGrabbed && emgTearGate == null)
            {
                Debug.LogWarning("[HeadTear] EMG gate is not assigned; head cannot tear.");
            }
            return;
        }

        if (isHeldAfterTear && grabbable != null && grabbable.SelectingPointsCount == 0)
        {
            isHeldAfterTear = false;
            if (rb != null)
            {
                rb.isKinematic = false;
            }
            Debug.Log("[HeadTear] Head released -> physics enabled, should drop.");
        }
    }

    void LateUpdate()
    {

        if (isTorn || headBone == null) return;
        transform.position = headBone.position;
        transform.rotation = headBone.rotation;
    }

    void TearOff()
    {
        isTorn = true;
        isHeldAfterTear = true;

        Mesh headMesh = (bodyRenderer != null && headBone != null)
            ? ExtractHeadMesh(bodyRenderer, headBone, headWeightThreshold, headProximityRadius,
                               headProximityMinWeight, transform.worldToLocalMatrix)
            : null;

        if (headMesh != null)
        {
      
            MeshFilter mf = gameObject.GetComponent<MeshFilter>();
            if (mf == null) mf = gameObject.AddComponent<MeshFilter>();
            mf.mesh = headMesh;

            MeshRenderer mr = gameObject.GetComponent<MeshRenderer>();
            if (mr == null) mr = gameObject.AddComponent<MeshRenderer>();
            mr.sharedMaterials = bodyRenderer.sharedMaterials;

            Debug.Log($"[HeadTear] Cut head mesh with {headMesh.vertexCount} verts.");


            if (headBone != null)
            {
                headBone.localScale = Vector3.zero;
            }
        }
        else
        {
            Debug.LogWarning("[HeadTear] Could not extract head mesh — real head left visible so " +
                              "you're not left with nothing. Lower Head Weight Threshold (try 0.15 " +
                              "or even 0.05) and test again.");
        }


        transform.SetParent(null, true);

        if (bloodDrip != null)
        {
            bloodDrip.StartDripping();
        }

        if (cachedChase != null)
        {
            cachedChase.Die();
            Debug.Log("[HeadTear] Called ZombieChase.Die() successfully.");
        }
        else
        {
            Debug.LogWarning("[HeadTear] cachedChase was null — Die() not called. " +
                              "Make sure HeadGrabPoint is a child of the object ZombieChase is on.");
        }

        Debug.Log("[HeadTear] Head detached — cut mesh now held independently in hand.");
    }


    private static Mesh ExtractHeadMesh(SkinnedMeshRenderer smr, Transform boneToExtract, float weightThreshold,
                                         float proximityRadius, float proximityMinWeight,
                                         Matrix4x4 targetWorldToLocal)
    {
        Mesh sourceMesh = smr.sharedMesh;
        if (sourceMesh == null) return null;

        Transform[] bones = smr.bones;
        int headBoneIndex = System.Array.IndexOf(bones, boneToExtract);
        if (headBoneIndex < 0)
        {
            Debug.LogError("[HeadTear] Head bone not found in SkinnedMeshRenderer.bones — is it the same skeleton?");
            return null;
        }

        Mesh baked = new Mesh();
        smr.BakeMesh(baked);

        BoneWeight[] boneWeights = sourceMesh.boneWeights;
        Vector3[] bakedVerts = baked.vertices;
        Vector2[] sourceUVs = sourceMesh.uv;

        Matrix4x4 bakeLocalToTargetLocal = targetWorldToLocal * smr.transform.localToWorldMatrix;

        Vector3 headLocalPos = smr.transform.InverseTransformPoint(boneToExtract.position);
        bool useProximity = proximityRadius > 0f;
        float sqrRadius = proximityRadius * proximityRadius;

        bool[] isHeadVertex = new bool[bakedVerts.Length];
        int weightOnlyCount = 0;
        int proximityAddedCount = 0;

        for (int i = 0; i < bakedVerts.Length; i++)
        {
            float headWeight = 0f;
            if (i < boneWeights.Length)
            {
                BoneWeight bw = boneWeights[i];
                if (bw.boneIndex0 == headBoneIndex) headWeight += bw.weight0;
                if (bw.boneIndex1 == headBoneIndex) headWeight += bw.weight1;
                if (bw.boneIndex2 == headBoneIndex) headWeight += bw.weight2;
                if (bw.boneIndex3 == headBoneIndex) headWeight += bw.weight3;
            }

            bool passesWeight = headWeight >= weightThreshold;
            bool passesProximity = useProximity
                && headWeight >= proximityMinWeight
                && (bakedVerts[i] - headLocalPos).sqrMagnitude <= sqrRadius;

            isHeadVertex[i] = passesWeight || passesProximity;
            if (passesWeight) weightOnlyCount++;
            else if (passesProximity) proximityAddedCount++;
        }

        if (useProximity)
        {
            Debug.Log($"[HeadTear] Vertex selection: {weightOnlyCount} by weight (>= {weightThreshold}), " +
                      $"+{proximityAddedCount} added by proximity (<= {proximityRadius}m, weight >= " +
                      $"{proximityMinWeight}). Total: {weightOnlyCount + proximityAddedCount}/{bakedVerts.Length}.");
        }

        int submeshCount = sourceMesh.subMeshCount;
        List<int>[] keptTrianglesPerSubmesh = new List<int>[submeshCount];
        int totalKeptTriangles = 0;

        for (int s = 0; s < submeshCount; s++)
        {
            int[] subTris = sourceMesh.GetTriangles(s);
            List<int> kept = new List<int>();

            for (int t = 0; t < subTris.Length; t += 3)
            {
                int a = subTris[t], b = subTris[t + 1], c = subTris[t + 2];
                if (isHeadVertex[a] && isHeadVertex[b] && isHeadVertex[c])
                {
                    kept.Add(a);
                    kept.Add(b);
                    kept.Add(c);
                }
            }

            keptTrianglesPerSubmesh[s] = kept;
            totalKeptTriangles += kept.Count;
        }

        if (totalKeptTriangles == 0)
        {
            int headVertCount = 0;
            for (int i = 0; i < isHeadVertex.Length; i++) if (isHeadVertex[i]) headVertCount++;


            int[] cornerHistogram = new int[4];
            for (int s = 0; s < submeshCount; s++)
            {
                int[] subTris = sourceMesh.GetTriangles(s);
                for (int t = 0; t < subTris.Length; t += 3)
                {
                    int corners = (isHeadVertex[subTris[t]] ? 1 : 0)
                                + (isHeadVertex[subTris[t + 1]] ? 1 : 0)
                                + (isHeadVertex[subTris[t + 2]] ? 1 : 0);
                    cornerHistogram[corners]++;
                }
            }

            Debug.LogWarning($"[HeadTear] 0 triangles matched at threshold {weightThreshold} " +
                              $"(proximity radius {proximityRadius}m) across {submeshCount} submesh(es). " +
                              $"{headVertCount}/{isHeadVertex.Length} vertices passed individually. " +
                              $"Corner histogram — 0 corners: {cornerHistogram[0]}, 1: {cornerHistogram[1]}, " +
                              $"2: {cornerHistogram[2]}, 3: {cornerHistogram[3]}. If 2 and 3 are both near " +
                              $"zero while headVertCount is large, the passing vertices are scattered, not " +
                              $"contiguous — try raising Head Proximity Radius instead of lowering the weight " +
                              $"threshold.");
            return null;
        }

        Dictionary<int, int> remap = new Dictionary<int, int>();
        List<Vector3> newVerts = new List<Vector3>();
        List<Vector2> newUVs = new List<Vector2>();
        List<int>[] newTrisPerSubmesh = new List<int>[submeshCount];

        for (int s = 0; s < submeshCount; s++)
        {
            List<int> newTris = new List<int>();
            foreach (int oldIndex in keptTrianglesPerSubmesh[s])
            {
                if (!remap.TryGetValue(oldIndex, out int newIndex))
                {
                    newIndex = newVerts.Count;
                    remap[oldIndex] = newIndex;
                    newVerts.Add(bakeLocalToTargetLocal.MultiplyPoint3x4(bakedVerts[oldIndex]));
                    newUVs.Add(oldIndex < sourceUVs.Length ? sourceUVs[oldIndex] : Vector2.zero);
                }
                newTris.Add(newIndex);
            }
            newTrisPerSubmesh[s] = newTris;
        }


        CapBoundaryHoles(newVerts, newUVs, newTrisPerSubmesh, submeshCount);

        Mesh headMesh = new Mesh();
        headMesh.SetVertices(newVerts);
        headMesh.SetUVs(0, newUVs);
        headMesh.subMeshCount = submeshCount;
        for (int s = 0; s < submeshCount; s++)
        {
            headMesh.SetTriangles(newTrisPerSubmesh[s], s);
        }
        headMesh.RecalculateNormals();
        headMesh.RecalculateBounds();

        Debug.Log($"[HeadTear] Extracted head mesh: {newVerts.Count} verts, " +
                  $"{totalKeptTriangles / 3} triangles across {submeshCount} submesh(es).");

        return headMesh;
    }


    private static void CapBoundaryHoles(List<Vector3> newVerts, List<Vector2> newUVs,
                                          List<int>[] newTrisPerSubmesh, int submeshCount)
    {

        Dictionary<(int, int), int> edgeCount = new Dictionary<(int, int), int>();
        Dictionary<(int, int), (int, int)> edgeDirection = new Dictionary<(int, int), (int, int)>();

        void AddEdge(int a, int b)
        {
            (int, int) key = a < b ? (a, b) : (b, a);
            edgeCount.TryGetValue(key, out int count);
            edgeCount[key] = count + 1;
            if (!edgeDirection.ContainsKey(key)) edgeDirection[key] = (a, b);
        }

        for (int s = 0; s < submeshCount; s++)
        {
            List<int> tris = newTrisPerSubmesh[s];
            for (int t = 0; t < tris.Count; t += 3)
            {
                int a = tris[t], b = tris[t + 1], c = tris[t + 2];
                AddEdge(a, b);
                AddEdge(b, c);
                AddEdge(c, a);
            }
        }


        Dictionary<int, int> nextVertex = new Dictionary<int, int>();
        foreach (KeyValuePair<(int, int), int> kvp in edgeCount)
        {
            if (kvp.Value == 1)
            {
                (int a, int b) = edgeDirection[kvp.Key];
                nextVertex[a] = b;
            }
        }

        if (nextVertex.Count == 0) return; 

        HashSet<int> visited = new HashSet<int>();
        List<int> capTriangles = new List<int>();
        int loopsCapped = 0;

        foreach (int startVertex in new List<int>(nextVertex.Keys))
        {
            if (visited.Contains(startVertex)) continue;

            List<int> loop = new List<int>();
            int current = startVertex;
            bool closed = false;

            while (!visited.Contains(current))
            {
                visited.Add(current);
                loop.Add(current);

                if (!nextVertex.TryGetValue(current, out int next)) break; 
                current = next;

                if (current == startVertex)
                {
                    closed = true;
                    break;
                }
            }

            if (!closed || loop.Count < 3)
            {
                Debug.LogWarning($"[HeadTear] Boundary chain starting at vertex {startVertex} didn't " +
                                  $"close into a clean loop ({loop.Count} verts) — leaving it uncapped. " +
                                  $"The cut mesh may have a non-manifold edge or a jagged/disconnected " +
                                  $"boundary; a gap may remain there.");
                continue;
            }

            Vector3 centroid = Vector3.zero;
            Vector2 uvCentroid = Vector2.zero;
            for (int i = 0; i < loop.Count; i++)
            {
                centroid += newVerts[loop[i]];
                if (loop[i] < newUVs.Count) uvCentroid += newUVs[loop[i]];
            }
            centroid /= loop.Count;
            uvCentroid /= loop.Count;

            int centroidIndex = newVerts.Count;
            newVerts.Add(centroid);
            newUVs.Add(uvCentroid);

            for (int i = 0; i < loop.Count; i++)
            {
                int a = loop[i];
                int b = loop[(i + 1) % loop.Count];

                capTriangles.Add(b);
                capTriangles.Add(a);
                capTriangles.Add(centroidIndex);
            }

            loopsCapped++;
        }

        if (capTriangles.Count > 0)
        {
            newTrisPerSubmesh[0].AddRange(capTriangles);
            Debug.Log($"[HeadTear] Sealed {loopsCapped} boundary loop(s) with {capTriangles.Count / 3} " +
                      $"cap triangle(s).");
        }
    }
}
