package bo.edu.uagrm.autonexus.operations.application;

import java.util.List;

/** Stable page envelope shared by every list operation. */
public record Page<T>(List<T> items, int total, int limit, int offset) {}
