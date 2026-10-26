package bo.edu.uagrm.autonexus.operations.application;

public final class CheckReadiness {
    private final DatabaseAvailability database;

    public CheckReadiness(DatabaseAvailability database) {
        this.database = database;
    }

    public boolean execute() {
        return database.isAvailable();
    }
}
