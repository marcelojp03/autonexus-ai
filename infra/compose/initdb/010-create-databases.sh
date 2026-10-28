#!/usr/bin/env bash
set -Eeuo pipefail

# Runs only when this Compose's PostgreSQL volume is initialized. Never log secrets.
for name in POSTGRES_USER POSTGRES_DB OPERATIONS_DB OPERATIONS_USER EMPLOYEES_DB EMPLOYEES_USER FINANCE_DB FINANCE_USER; do
  if [[ ! ${!name:-} =~ ^[a-z][a-z0-9_]{0,62}$ || ${!name} == pg_* ]]; then
    printf 'Invalid database/role identifier in %s\n' "$name" >&2
    exit 1
  fi
done
for name in OPERATIONS_PASSWORD EMPLOYEES_PASSWORD FINANCE_PASSWORD; do
  if [[ -z ${!name:-} ]]; then printf 'Missing required %s\n' "$name" >&2; exit 1; fi
done
if [[ $OPERATIONS_DB == $EMPLOYEES_DB || $OPERATIONS_DB == $FINANCE_DB || $EMPLOYEES_DB == $FINANCE_DB || $OPERATIONS_USER == $EMPLOYEES_USER || $OPERATIONS_USER == $FINANCE_USER || $EMPLOYEES_USER == $FINANCE_USER || $OPERATIONS_USER == $POSTGRES_USER || $EMPLOYEES_USER == $POSTGRES_USER || $FINANCE_USER == $POSTGRES_USER ]]; then
  printf 'Application databases and roles must be distinct\n' >&2
  exit 1
fi
for database in "$OPERATIONS_DB" "$EMPLOYEES_DB" "$FINANCE_DB"; do
  case $database in postgres|template0|template1) printf 'Reserved application database name\n' >&2; exit 1;; esac
done

# psql reads passwords from its environment, not process arguments.
# SQL identifiers/literals are quoted by PostgreSQL format(), never shell interpolation.
psql --no-psqlrc --quiet --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv operations_db OPERATIONS_DB
\getenv operations_user OPERATIONS_USER
\getenv operations_password OPERATIONS_PASSWORD
\getenv employees_db EMPLOYEES_DB
\getenv employees_user EMPLOYEES_USER
\getenv employees_password EMPLOYEES_PASSWORD
\getenv finance_db FINANCE_DB
\getenv finance_user FINANCE_USER
\getenv finance_password FINANCE_PASSWORD
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'operations_user', :'operations_password') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'employees_user', :'employees_password') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'finance_user', :'finance_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'operations_db', :'operations_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'employees_db', :'employees_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'finance_db', :'finance_user') \gexec
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
REVOKE ALL ON DATABASE template1 FROM PUBLIC;
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'operations_db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'employees_db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'finance_db') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', :'operations_db', :'operations_user') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', :'employees_db', :'employees_user') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', :'finance_db', :'finance_user') \gexec
SQL
