package bo.edu.uagrm.autonexus.operations.domain;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class EvidenceRulesTest {
    private static final String SHA256 = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="; // 32 bytes base64

    private static byte[] bytes(int... values) {
        byte[] result = new byte[values.length];
        for (int index = 0; index < values.length; index++) result[index] = (byte) values[index];
        return result;
    }

    @Test
    void acceptsOnlyTheClosedTypesAndTheirCeilings() {
        assertEquals(5L * 1024 * 1024, EvidenceRules.limit("image/jpeg"));
        assertEquals(20L * 1024 * 1024, EvidenceRules.limit("video/mp4"));
        assertNull(EvidenceRules.limit("application/pdf"));
        assertNull(EvidenceRules.limit(null));
        assertEquals("image/png", EvidenceRules.contentType(" IMAGE/PNG "));
        assertThrows(OperationsError.class, () -> EvidenceRules.contentType("image/gif"));
        assertEquals(1024L, EvidenceRules.size(1024, "image/png"));
        assertThrows(OperationsError.class, () -> EvidenceRules.size(0, "image/png"));
        assertThrows(OperationsError.class, () -> EvidenceRules.size(6L * 1024 * 1024, "image/jpeg"));
    }

    @Test
    void rejectsFileNamesThatCouldCarryAPath() {
        assertEquals("foto.jpg", EvidenceRules.fileName("foto.jpg"));
        for (String value : new String[] {"../foto.jpg", "a/b.jpg", "a\\b.jpg", "", "x".repeat(121)}) {
            assertThrows(OperationsError.class, () -> EvidenceRules.fileName(value), value);
        }
    }

    @Test
    void requiresARealSha256DigestInBase64() {
        assertEquals(SHA256, EvidenceRules.checksum(SHA256));
        for (String value : new String[] {"", "abc", "!!!!", "AAAA"}) {
            assertThrows(OperationsError.class, () -> EvidenceRules.checksum(value), value);
        }
        // 43 characters plus padding is a valid 32-byte digest; length alone is not the check.
    }

    @Test
    void detectsTheFormatFromTheLeadingBytes() {
        assertEquals("image/jpeg", EvidenceRules.detect(bytes(0xFF, 0xD8, 0xFF, 0xE0)));
        assertEquals("image/png", EvidenceRules.detect(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)));
        assertEquals("image/webp", EvidenceRules.detect(concat("RIFF", 0, 0, 0, 0, "WEBPVP8 ")));
        assertEquals("video/mp4", EvidenceRules.detect(concat(0, 0, 0, 0x20, "ftypisom")));
        assertNull(EvidenceRules.detect(bytes(0x25, 0x50, 0x44, 0x46)));
        assertNull(EvidenceRules.detect(new byte[0]));
        assertNull(EvidenceRules.detect(null));
    }

    @Test
    void verificationRejectsSizeChecksumAndFormatMismatches() {
        byte[] png = bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A);
        StoredObject stored = new StoredObject(1024L, "image/png", "\"etag\"", null, SHA256);
        assertNull(EvidenceRules.verify("image/png", 1024, SHA256, stored, png));
        assertEquals("EVIDENCE_OBJECT_MISSING", EvidenceRules.verify("image/png", 1024, SHA256, null, png));
        assertEquals("EVIDENCE_SIZE_MISMATCH",
                EvidenceRules.verify("image/png", 1024, SHA256, new StoredObject(2048L, "image/png", "\"e\"", null, SHA256), png));
        assertEquals("EVIDENCE_CHECKSUM_MISMATCH",
                EvidenceRules.verify("image/png", 1024, SHA256, new StoredObject(1024L, "image/png", "\"e\"", null, null), png));
        // A PDF renamed to .png is the real attack: the declared type never proves the content.
        assertEquals("EVIDENCE_CONTENT_MISMATCH",
                EvidenceRules.verify("image/png", 1024, SHA256, stored, bytes(0x25, 0x50, 0x44, 0x46)));
    }

    private static byte[] concat(Object... parts) {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        for (Object part : parts) {
            if (part instanceof String text) out.writeBytes(text.getBytes(java.nio.charset.StandardCharsets.US_ASCII));
            else out.write(((Number) part).intValue());
        }
        return out.toByteArray();
    }
}
