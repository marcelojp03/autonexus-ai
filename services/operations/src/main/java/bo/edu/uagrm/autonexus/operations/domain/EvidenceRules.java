package bo.edu.uagrm.autonexus.operations.domain;

import java.util.Base64;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * CU16 evidence validation. It is pure so the real file rules are testable without a bucket:
 * declared metadata, the size and checksum the storage reports, and the leading bytes of the
 * stored object, which are what actually prove the format.
 */
public final class EvidenceRules {
    private EvidenceRules() {}

    private static final Pattern CHECKSUM = Pattern.compile("^[A-Za-z0-9+/]{43}=$");
    private static final Set<String> SEPARATORS = Set.of("/", "\\");

    /** Allowed type and its ceiling, or null when the declared type is not acceptable. */
    public static Long limit(String contentType) {
        return contentType == null ? null : Execution.LIMITS.get(contentType.toLowerCase(Locale.ROOT));
    }

    public static String contentType(Object value) {
        if (!(value instanceof String text)) throw OperationsError.invalid();
        String normalized = text.trim().toLowerCase(Locale.ROOT);
        if (limit(normalized) == null) throw OperationsError.invalid();
        return normalized;
    }

    public static String fileName(Object value) {
        if (!(value instanceof String text)) throw OperationsError.invalid();
        String normalized = Validation.text(text, 1, Execution.MAX_FILE_NAME);
        if (SEPARATORS.stream().anyMatch(normalized::contains) || normalized.contains("..")) {
            throw OperationsError.invalid();
        }
        return normalized;
    }

    public static long size(Object value, String contentType) {
        if (!(value instanceof Number number) || number.doubleValue() != number.longValue()) {
            throw OperationsError.invalid();
        }
        long bytes = number.longValue();
        Long limit = limit(contentType);
        if (bytes < 1 || limit == null || bytes > limit) throw OperationsError.invalid();
        return bytes;
    }

    /** Base64 of a 32-byte SHA-256 digest; anything else is not a checksum we can verify. */
    public static String checksum(Object value) {
        if (!(value instanceof String text) || !CHECKSUM.matcher(text).matches()) {
            throw OperationsError.invalid();
        }
        try {
            if (Base64.getDecoder().decode(text).length != 32) throw OperationsError.invalid();
        } catch (IllegalArgumentException malformed) {
            throw OperationsError.invalid();
        }
        return text;
    }

    /** Format actually present in the first bytes, or null when the signature is not allowed. */
    public static String detect(byte[] prefix) {
        if (prefix == null) return null;
        if (startsWith(prefix, new int[] {0xFF, 0xD8, 0xFF})) return "image/jpeg";
        if (startsWith(prefix, new int[] {0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A})) return "image/png";
        if (prefix.length >= 12
                && ascii(prefix, 0, "RIFF")
                && ascii(prefix, 8, "WEBP")) return "image/webp";
        if (prefix.length >= 12 && ascii(prefix, 4, "ftyp")) return "video/mp4";
        return null;
    }

    private static boolean startsWith(byte[] value, int[] signature) {
        if (value.length < signature.length) return false;
        for (int index = 0; index < signature.length; index++) {
            if ((value[index] & 0xFF) != signature[index]) return false;
        }
        return true;
    }

    private static boolean ascii(byte[] value, int offset, String expected) {
        if (value.length < offset + expected.length()) return false;
        for (int index = 0; index < expected.length(); index++) {
            if ((char) (value[offset + index] & 0xFF) != expected.charAt(index)) return false;
        }
        return true;
    }

    /** First failure of the stored object against the declared request, or null when it matches. */
    public static String verify(
            String declaredType,
            long declaredSize,
            String declaredChecksum,
            StoredObject stored,
            byte[] prefix) {
        String type = contentType(declaredType);
        size(declaredSize, type);
        checksum(declaredChecksum);
        if (stored == null) return "EVIDENCE_OBJECT_MISSING";
        Long limit = limit(type);
        if (stored.size() == null || limit == null || stored.size() < 1 || stored.size() > limit) {
            return "EVIDENCE_SIZE_MISMATCH";
        }
        if (stored.size() != declaredSize) return "EVIDENCE_SIZE_MISMATCH";
        if (stored.checksumSha256() == null || !stored.checksumSha256().equals(declaredChecksum)) {
            return "EVIDENCE_CHECKSUM_MISMATCH";
        }
        String detected = detect(prefix);
        if (detected == null || !detected.equals(type)) return "EVIDENCE_CONTENT_MISMATCH";
        return null;
    }
}
