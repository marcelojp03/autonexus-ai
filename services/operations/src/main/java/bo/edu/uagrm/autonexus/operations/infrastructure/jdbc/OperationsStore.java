package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import tools.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;

/** Idempotency and audit helpers shared by the four JDBC repositories. */
abstract class OperationsStore {
    protected final JdbcClient jdbc;
    private final ObjectMapper json;

    protected OperationsStore(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** Unit separator: it never appears in validated text, so distinct contents never collide. */
    private static final char SEPARATOR = '\u001F';

    protected static String fingerprint(Object... parts) {
        StringBuilder builder = new StringBuilder();
        for (Object part : parts) builder.append(part == null ? "" : part.toString()).append(SEPARATOR);
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(builder.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte value : digest) hex.append(String.format("%02x", value));
            return hex.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }

    /** Returns the recorded entity id when the operation was already applied with the same content. */
    protected Optional<UUID> replayed(UUID operationId, String fingerprint) {
        var rows = jdbc.sql("SELECT fingerprint, result FROM operations.operations_operations WHERE operation_id = ?")
                .param(operationId)
                .query((rs, index) -> new String[] {rs.getString("fingerprint"), rs.getString("result")})
                .list();
        if (rows.isEmpty()) return Optional.empty();
        if (!rows.get(0)[0].equals(fingerprint)) {
            throw bo.edu.uagrm.autonexus.operations.domain.OperationsError.conflict("IDEMPOTENCY_CONFLICT");
        }
        try {
            return Optional.of(UUID.fromString(json.readTree(rows.get(0)[1]).get("id").asText()));
        } catch (Exception error) {
            throw new IllegalStateException("Invalid stored operation result", error);
        }
    }

    /**
     * Records the operation result. Returns true when this call stored it and false when a
     * concurrent request stored the same operation first (a replay). A different fingerprint is a
     * conflict, never a silent replay.
     */
    protected boolean remember(UUID operationId, String fingerprint, UUID entityId) {
        int rows = jdbc.sql("""
                        INSERT INTO operations.operations_operations(operation_id, fingerprint, result)
                        VALUES(?,?,?::jsonb) ON CONFLICT (operation_id) DO NOTHING
                        """)
                .params(operationId, fingerprint, "{\"id\":\"" + entityId + "\"}")
                .update();
        if (rows == 1) return true;
        String stored = jdbc.sql("SELECT fingerprint FROM operations.operations_operations WHERE operation_id = ?")
                .param(operationId).query(String.class).optional().orElse(null);
        if (stored == null || !stored.equals(fingerprint)) {
            throw bo.edu.uagrm.autonexus.operations.domain.OperationsError.conflict("IDEMPOTENCY_CONFLICT");
        }
        return false;
    }

    protected void audit(String entity, UUID entityId, String action, String actor, int version, Object snapshot) {
        jdbc.sql("""
                INSERT INTO operations.operations_history(id, entity, entity_id, action, actor_subject, occurred_at, version, snapshot)
                VALUES(?,?,?,?,?,now(),?,?::jsonb)
                """)
                .params(UUID.randomUUID(), entity, entityId, action, actor, version, json.writeValueAsString(snapshot))
                .update();
    }
}
