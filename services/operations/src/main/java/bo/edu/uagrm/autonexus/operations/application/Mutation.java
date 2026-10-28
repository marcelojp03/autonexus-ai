package bo.edu.uagrm.autonexus.operations.application;

/** Result of an idempotent mutation: the stored state plus whether it was a replay. */
public record Mutation<T>(T value, boolean replayed) {}
