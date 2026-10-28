package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/** Sanitized business and parsing errors; internals never leave the service. */
@RestControllerAdvice
public class OperationsExceptionHandler {
    private static final Map<Integer, String> MESSAGES = Map.of(
            400, "Invalid request",
            404, "Record not found",
            409, "Operation conflict",
            503, "Service unavailable");

    @ExceptionHandler(OperationsError.class)
    public ResponseEntity<Map<String, Object>> business(OperationsError error) {
        return body(error.statusCode(), error.code());
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class, IllegalArgumentException.class})
    public ResponseEntity<Map<String, Object>> invalidRequest() {
        return body(400, "VALIDATION_ERROR");
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> unexpected() {
        return body(500, "INTERNAL_ERROR");
    }

    private static ResponseEntity<Map<String, Object>> body(int status, String code) {
        return ResponseEntity.status(status).body(Map.of(
                "statusCode", status,
                "message", MESSAGES.getOrDefault(status, "Request failed"),
                "code", code));
    }
}
