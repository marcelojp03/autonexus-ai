package bo.edu.uagrm.autonexus.operations.infrastructure.config;

import java.net.URI;

public final class TransportConfiguration {
    private TransportConfiguration() {}

    public static String url(String value, String name) {
        try {
            var uri = URI.create(value);
            if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || value.contains("*")) throw new IllegalArgumentException();
            return value;
        } catch (IllegalArgumentException error) { throw new IllegalArgumentException("Invalid configuration: " + name); }
    }

    public static String origin(String value) {
        var uri = URI.create(url(value, "WEB_ALLOWED_ORIGINS"));
        if (!uri.getRawPath().isEmpty()) throw new IllegalArgumentException("Invalid configuration: WEB_ALLOWED_ORIGINS");
        return value;
    }
}
