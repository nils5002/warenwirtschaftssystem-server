FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

# Build-Metadaten (Systemupdate). Werden beim Build durchgereicht — z. B.
# docker build --build-arg APP_GIT_COMMIT=$(git rev-parse HEAD) ... — oder
# ueber die Stack-Variablen in Portainer. Bleiben sie leer, gilt die
# installierte Version als unbekannt; die App startet und laeuft normal.
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
