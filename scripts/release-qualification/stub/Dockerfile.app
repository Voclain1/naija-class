FROM python:3.12-alpine
ARG MODE=good
ARG REV
LABEL org.opencontainers.image.revision=$REV
COPY server.py /stub/server.py
RUN echo "$MODE" > /stub/mode
CMD ["python", "/stub/server.py"]
