FROM eclipse-temurin:21-jdk-jammy@sha256:4e61d0b3471137e239397789661f6adeaf8db9adcfae45916b22f628c8a32dc0 AS build
WORKDIR /app/services/operations
COPY services/operations/mvnw services/operations/pom.xml ./
COPY services/operations/.mvn ./.mvn
COPY services/operations/src/main ./src/main
RUN chmod +x mvnw && ./mvnw --batch-mode --no-transfer-progress -Dmaven.test.skip=true package

FROM eclipse-temurin:21-jre-jammy@sha256:9603446cf51296842eab342514857cf7ab55a8891cd564e6c68ec237fae65a16 AS runtime
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --create-home app
WORKDIR /app/services/operations
COPY --from=build --chown=app:app /app/services/operations/target/operations-0.0.1-SNAPSHOT.jar ./app.jar
COPY --chmod=0555 infra/local/service-entrypoint.sh /usr/local/bin/service-entrypoint
USER app
EXPOSE 8081
ENTRYPOINT ["/usr/local/bin/service-entrypoint"]
CMD ["java", "-jar", "app.jar"]
