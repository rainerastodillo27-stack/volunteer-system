import os
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from db import get_connection


load_dotenv()


class StoragePayload(BaseModel):
    value: Any


app = FastAPI(title="Volcre Storage API")

allowed_origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/storage/{key}")
def get_storage_item(key: str) -> dict[str, Any]:
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("select value from app_storage where key = %s", (key,))
            row = cursor.fetchone()

    return {"key": key, "value": None if row is None else row["value"]}


@app.put("/storage/{key}")
def put_storage_item(key: str, payload: StoragePayload) -> dict[str, str]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                insert into app_storage (key, value, updated_at)
                values (%s, %s, now())
                on conflict (key) do update set
                  value = excluded.value,
                  updated_at = excluded.updated_at
                """,
                (key, Jsonb(payload.value)),
            )
        connection.commit()

    return {"status": "ok"}


@app.delete("/storage/{key}")
def delete_storage_item(key: str) -> dict[str, str]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("delete from app_storage where key = %s", (key,))
        connection.commit()

    return {"status": "ok"}


@app.delete("/storage")
def clear_storage() -> dict[str, str]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("delete from app_storage")
        connection.commit()

    return {"status": "ok"}


@app.post("/bootstrap")
def bootstrap_storage() -> dict[str, str]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                create table if not exists app_storage (
                  key text primary key,
                  value jsonb not null,
                  updated_at timestamptz not null default now()
                )
                """
            )
        connection.commit()

    return {"status": "ok"}
