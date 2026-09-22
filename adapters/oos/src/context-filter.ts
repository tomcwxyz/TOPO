import type { Sensitivity } from "@topo/schemas";

const sensitivityRank: Record<Sensitivity, number> = {
  ordinary: 0,
  personal: 1,
  sensitive: 2,
  restricted: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sensitivityOf(value: unknown): Sensitivity | undefined {
  if (
    value === "ordinary" ||
    value === "personal" ||
    value === "sensitive" ||
    value === "restricted"
  ) {
    return value;
  }
  return undefined;
}

export function sensitivityAllowed(
  value: unknown,
  ceiling: Sensitivity,
): boolean {
  const sensitivity = sensitivityOf(value);
  return (
    sensitivity !== undefined &&
    sensitivityRank[sensitivity] <= sensitivityRank[ceiling]
  );
}

/**
 * Apply an additional disclosure ceiling to an already-governed Context Packet.
 *
 * This function may only narrow a packet. It never adds objects, evidence or
 * provenance that the upstream TOPO resolver did not return.
 */
export function narrowContextPacket(
  value: unknown,
  ceiling: Sensitivity,
  extensionKey = "topo.transport_sensitivity_ceiling",
): unknown {
  if (!isRecord(value) || !Array.isArray(value.objects)) return value;

  const objects = value.objects.filter((item) => {
    if (!isRecord(item) || !isRecord(item.value)) return false;
    return sensitivityAllowed(item.value.sensitivity, ceiling);
  });

  const selectedIds = new Set(
    objects
      .map((item) => (isRecord(item) ? item.id : undefined))
      .filter((id): id is string => typeof id === "string"),
  );

  const evidenceRefs = new Set<string>();
  for (const item of objects) {
    if (!isRecord(item) || !isRecord(item.value)) continue;
    const sourceRefs = item.value.source_refs;
    if (!Array.isArray(sourceRefs)) continue;
    for (const sourceRef of sourceRefs) {
      if (!isRecord(sourceRef)) continue;
      const sourceId = sourceRef.source_id;
      if (typeof sourceId === "string") evidenceRefs.add(sourceId);
    }
  }

  const provenance = isRecord(value.provenance)
    ? {
        ...value.provenance,
        derived_from: Array.isArray(value.provenance.derived_from)
          ? value.provenance.derived_from.filter(
              (id): id is string =>
                typeof id === "string" && selectedIds.has(id),
            )
          : value.provenance.derived_from,
        extensions: isRecord(value.provenance.extensions)
          ? {
              ...value.provenance.extensions,
              page_revisions: isRecord(
                value.provenance.extensions.page_revisions,
              )
                ? Object.fromEntries(
                    Object.entries(
                      value.provenance.extensions.page_revisions,
                    ).filter(([id]) => selectedIds.has(id)),
                  )
                : value.provenance.extensions.page_revisions,
            }
          : value.provenance.extensions,
      }
    : value.provenance;

  const extensions = isRecord(value.extensions)
    ? {
        ...value.extensions,
        "topo.relevance": isRecord(value.extensions["topo.relevance"])
          ? Object.fromEntries(
              Object.entries(value.extensions["topo.relevance"]).filter(([id]) =>
                selectedIds.has(id),
              ),
            )
          : value.extensions["topo.relevance"],
        [extensionKey]: ceiling,
      }
    : { [extensionKey]: ceiling };

  return {
    ...value,
    objects,
    evidence_refs: [...evidenceRefs],
    provenance,
    extensions,
  };
}

/** Apply an additional sensitivity ceiling to Memory Page search results. */
export function narrowPageSearch(
  value: unknown,
  ceiling: Sensitivity,
  field = "transportSensitivityCeiling",
): unknown {
  if (!isRecord(value) || !Array.isArray(value.results)) return value;

  return {
    ...value,
    results: value.results.filter((item) => {
      if (!isRecord(item) || !isRecord(item.memoryPage)) return false;
      return sensitivityAllowed(item.memoryPage.sensitivity, ceiling);
    }),
    [field]: ceiling,
  };
}
