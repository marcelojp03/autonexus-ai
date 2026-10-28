package bo.edu.uagrm.autonexus.operations.domain;

/** Business failure with a stable code; messages are sanitized by the HTTP layer. */
public class OperationsError extends RuntimeException {
    private final int statusCode;
    private final String code;

    public OperationsError(int statusCode, String code) {
        super(code);
        this.statusCode = statusCode;
        this.code = code;
    }

    public int statusCode() {
        return statusCode;
    }

    public String code() {
        return code;
    }

    public static OperationsError invalid() {
        return new OperationsError(400, "VALIDATION_ERROR");
    }

    public static OperationsError notFound(String code) {
        return new OperationsError(404, code);
    }

    public static OperationsError conflict(String code) {
        return new OperationsError(409, code);
    }
}
