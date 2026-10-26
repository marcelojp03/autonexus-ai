package bo.edu.uagrm.autonexus.operations;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class OperationsApplication {

	public static void main(String[] args) {
		String password = System.getenv("DB_PASSWORD");
		if (password == null || password.isBlank()) {
			throw new IllegalStateException("DB_PASSWORD must be configured and non-empty");
		}
		SpringApplication.run(OperationsApplication.class, args);
	}

}
