package bo.edu.uagrm.autonexus.operations.infrastructure.cu15;

import bo.edu.uagrm.autonexus.operations.application.ConfirmationPorts.Hash;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import tools.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

@Component
public class CanonicalJson implements Hash {
    private final ObjectMapper json;
    public CanonicalJson(ObjectMapper json) { this.json=json; }
    public String write(Object value) { return json.writeValueAsString(value); }
    public <T> T read(String value, Class<T> type) { return json.readValue(value,type); }
    public String hash(Object value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(write(sorted(value)).getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private Object sorted(Object value) {
        if (value instanceof Map<?,?> map) {
            var result=new TreeMap<String,Object>();
            map.forEach((k,v)->result.put((String)k,sorted(v))); return result;
        }
        if (value instanceof List<?> list) return list.stream().map(this::sorted).toList();
        return value;
    }
}
