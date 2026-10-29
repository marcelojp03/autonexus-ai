package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.domain.Confirmation;
import bo.edu.uagrm.autonexus.operations.domain.Confirmation.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ConfirmationProgressTest {
    private Saga saga() {
        Saga saga = new Saga(); saga.id = UUID.randomUUID().toString(); saga.orderId = UUID.randomUUID().toString();
        saga.input = new HashMap<>(); saga.input.put("operationId", UUID.randomUUID().toString());
        Confirmation.COMMANDS.forEach(command -> saga.steps.add(new Step(command)));
        return saga;
    }
    @Test void recoveryPublishesThePersistedActiveStepReasonWithoutPretendingRejection() {
        Saga saga = saga(); saga.status = "recovery_pending"; saga.phase = "authorize_quote";
        saga.step("authorize_quote").status = "uncertain";
        saga.step("authorize_quote").errorCode = "PARTICIPANT_RESULT_UNKNOWN";
        var view = ConfirmationController.progress(saga);
        assertEquals("recovery_pending", view.get("status"));
        assertEquals("PARTICIPANT_RESULT_UNKNOWN", view.get("errorCode"));
        assertNull(saga.errorCode, "The projection must not overwrite the business rejection reason");
    }
    @Test void compensationKeepsTheOriginalBusinessReasonAndStepDetails() {
        Saga saga = saga(); saga.status = "compensation_pending"; saga.phase = "release_assignment";
        saga.errorCode = "QUOTE_NOT_APPROVED";
        saga.step("release_assignment").status = "uncertain";
        saga.step("release_assignment").errorCode = "PARTICIPANT_RESULT_UNKNOWN";
        var view = ConfirmationController.progress(saga);
        assertEquals("compensation_pending", view.get("status"));
        assertEquals("QUOTE_NOT_APPROVED", view.get("errorCode"));
    }
}
