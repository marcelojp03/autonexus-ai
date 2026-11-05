# MS04 Inteligencia
Tecnología prevista: Python/FastAPI.
Persistencia: MongoDB.
Responsabilidad: Bloque 3.
Alcance: Inferencia remota, resultados y versiones, agentes internos y reportes. Los agentes consumen APIs sin depender de MCP.
## Estado
Aplicación FastAPI implementada en `app/`. El runtime de Compose se construye desde
`infra/local/docker/intelligence.Dockerfile` (contexto: raíz del repositorio).
Las dependencias de producción están fijadas en `requirements.txt`; no se cambian
para ejecutar las pruebas.

## Pruebas unitarias reproducibles (CU27)

Desde la raíz del repositorio, con Docker disponible, ejecutar en PowerShell o shell:

```sh
cd services/intelligence
docker build --no-cache --progress=plain -f Dockerfile.test -t autonexus-ms04-tests:local .
docker run --rm --network none autonexus-ms04-tests:local
docker run --rm --network none autonexus-ms04-tests:local python -m pip check
docker run --rm --network none autonexus-ms04-tests:local python --version
docker run --rm --network none autonexus-ms04-tests:local python -m pip list --format=freeze
```

`requirements-test.txt` incluye `requirements.txt` y añade solo `pytest==8.3.5`.
`Dockerfile.test` usa la misma base `python:3.11-slim-bookworm` y las mismas
bibliotecas del sistema que el runtime. La instalación parte de la imagen Python
base, no de una imagen de aplicación ni del entorno local modificado.
`Dockerfile.test.dockerignore` limita el contexto a los requisitos y fuentes Python
de `app/` y `tests/`: no envía `.venv`, configuración privada, modelos ni los
archivos locales `pyproject.toml`/`uv.lock`. No se usa `uv` ni se modifican esos
archivos. La construcción necesita internet para apt/pip; los tests no lo necesitan.
Los contenedores son desechables, sin volúmenes, puertos publicados ni credenciales;
no se inicia ni reinicia ningún servicio de Compose.

### Resultado comprobado

Construcción limpia con `--no-cache` y ejecución de los comandos anteriores:

- Python **3.11.18**; pytest **8.3.5**.
- `tests/test_client_analysis_review.py`: **3 passed in 6.47s**, salida **0**.
- `pip check`: **No broken requirements found**.
- Versiones instaladas de runtime: FastAPI **0.115.5**, Uvicorn **0.32.1**,
  PyJWT **2.10.1** (con extra crypto), HTTPX **0.27.2**, Motor **3.6.0**,
  PyMongo **4.9.2**, Pillow **10.4.0**, NumPy **1.26.4** y
  tensorflow-cpu **2.16.2**.
- Dependencias transitivas relevantes observadas: Pydantic **2.14.2**,
  Starlette **0.41.3**, Keras **3.15.1**, cryptography **50.0.2**.

Los requisitos fijan dependencias directas, no un lock transitivo completo; la
etiqueta de la imagen base tampoco fija digest. Los comandos permiten reconstruir
y verificar un entorno limpio compatible con el runtime, pero no prometen una
imagen idéntica byte a byte ni todas las versiones transitivas futuras.

Estas tres pruebas comprueban la separación de predicción y revisión humana,
la persistencia mediante una colección en memoria y la proyección de resultados
del cliente como no verificados por servidor. No acreditan MongoDB real, permisos,
HTTP extremo a extremo, carga de artefactos, inferencia TensorFlow ni precisión del
modelo. Para la evidencia de integración y sus límites, ver `docs/context/STATUS.md`
desde la raíz.

