#!/bin/sh
set -eu
# Bootstrap owns database/role creation; business records come only from owner APIs.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=operations_user="$OPERATIONS_USER" --set=operations_db="$OPERATIONS_DB" --set=operations_password="$OPERATIONS_PASSWORD" \
  --set=employees_user="$EMPLOYEES_USER" --set=employees_db="$EMPLOYEES_DB" --set=employees_password="$EMPLOYEES_PASSWORD" \
  --set=finance_user="$FINANCE_USER" --set=finance_db="$FINANCE_DB" --set=finance_password="$FINANCE_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'operations_user', :'operations_password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname=:'operations_user') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'employees_user', :'employees_password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname=:'employees_user') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'finance_user', :'finance_password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname=:'finance_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'operations_db', :'operations_user') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname=:'operations_db') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'employees_db', :'employees_user') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname=:'employees_db') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'finance_db', :'finance_user') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname=:'finance_db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', name) FROM (VALUES (:'operations_db'),(:'employees_db'),(:'finance_db')) databases(name) \gexec
SQL
