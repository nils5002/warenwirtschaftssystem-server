# Build-Kontext ist bewusst das REPO-ROOT (siehe docker-compose.yml), nicht
# ./backend: nur so liegen die Git-Metadaten des ausgelieferten Standes im
# Kontext und der laufende Commit laesst sich ohne manuelle Pflege ermitteln.
# Der Kontext ist ueber die .dockerignore im Repo-Root auf das Noetige reduziert.

# --- Stufe 1: Build-Version aus dem Checkout lesen ---------------------------
# Laeuft getrennt vom Laufzeit-Image, damit .git niemals im ausgelieferten
# Image landet. Schlaegt nie fehl — fehlt .git, gilt die Version als unbekannt.
FROM python:3.12-slim AS buildmeta
COPY . /repo
RUN python /repo/backend/scripts/derive_build_info.py /repo /build_info.json

# --- Stufe 2: Laufzeit-Image -------------------------------------------------
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY backend/ /app/

# Automatisch ermittelte Build-Version (Commit/Branch/Buildzeit).
COPY --from=buildmeta /build_info.json /app/build_info.json

# Optionale Ueberschreibung der Build-Metadaten, z. B. wenn ohne Git-Kontext
# gebaut wird (Deploy via ``git archive``). Gesetzte ENV-Werte haben Vorrang
# vor /app/build_info.json; leer = automatisch ermittelter Wert gilt.
ARG APP_GIT_COMMIT=""
ARG APP_GIT_BRANCH=""
ARG APP_BUILD_TIME=""
ENV APP_GIT_COMMIT=$APP_GIT_COMMIT
ENV APP_GIT_BRANCH=$APP_GIT_BRANCH
ENV APP_BUILD_TIME=$APP_BUILD_TIME

EXPOSE 8000

# Uvicorn-Flags bewusst minimal:
#   --proxy-headers + --forwarded-allow-ips=*: sorgen dafuer, dass Client-IP
#       und Scheme aus den Reverse-Proxy-Headern (X-Forwarded-For/Proto)
#       korrekt uebernommen werden. Ohne das laesst sich im App-Log nicht
#       unterscheiden, ob ein Request vom Reverse-Proxy oder direkt kam.
#   --timeout-keep-alive 30: schliesst Keep-Alive-Verbindungen nach 30s
#       idle, statt sie die Default 5s lang offen zu lassen. Reduziert das
#       Risiko, dass der Reverse-Proxy auf eine bereits halb geschlossene
#       Connection schreibt und damit 502 produziert.
# Workers bleiben BEWUSST auf 1 — SQLite kann bei mehreren Writer-Prozessen
# trotz WAL in Lock-Konflikte laufen. Eine Worker-Erhoehung waere ein
# separater, groesserer Schritt (z. B. zusammen mit Postgres).
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--proxy-headers", \
     "--forwarded-allow-ips=*", \
     "--timeout-keep-alive", "30"]
