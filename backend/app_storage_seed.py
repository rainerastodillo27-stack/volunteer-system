import json
from datetime import datetime, timedelta, timezone
from typing import Any

from .db import get_db_mode, get_postgres_connection, get_sqlite_connection


def _iso(year: int, month: int, day: int) -> str:
    return datetime(year, month, day, tzinfo=timezone.utc).isoformat()


def build_demo_app_storage() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    return {
        "users": [
            {
                "id": "admin-1",
                "email": "admin@nvc.org",
                "password": "admin123",
                "role": "admin",
                "name": "NVC Admin Account",
                "phone": "+63 917 000 0001",
                "userType": "Adult",
                "pillarsOfInterest": ["Education", "Livelihood", "Nutrition"],
                "createdAt": now_iso,
            },
            {
                "id": "volunteer-1",
                "email": "volunteer@example.com",
                "password": "volunteer123",
                "role": "volunteer",
                "name": "Volunteer Account",
                "phone": "+0987654321",
                "userType": "Student",
                "pillarsOfInterest": ["Education", "Nutrition"],
                "createdAt": now_iso,
            },
            {
                "id": "partner-user-1",
                "email": "partner@livelihoods.org",
                "password": "partner123",
                "role": "partner",
                "name": "Partner Org Account",
                "phone": "+919876543211",
                "userType": "Adult",
                "pillarsOfInterest": ["Livelihood"],
                "createdAt": now_iso,
            },
            {
                "id": "partner-user-2",
                "email": "partnerships@pbsp.org.ph",
                "password": "partner123",
                "role": "partner",
                "name": "PBSP Account",
                "phone": "+63 2 8818 8678",
                "userType": "Adult",
                "pillarsOfInterest": ["Education", "Livelihood", "Nutrition"],
                "createdAt": now_iso,
            },
            {
                "id": "partner-user-3",
                "email": "partnerships@jollibeefoundation.org",
                "password": "partner123",
                "role": "partner",
                "name": "Jollibee Foundation Account",
                "phone": "+63 2 8634 1111",
                "userType": "Adult",
                "pillarsOfInterest": ["Nutrition", "Livelihood"],
                "createdAt": now_iso,
            },
        ],
        "partners": [
            {
                "id": "partner-2",
                "name": "LGU Kabankalan Livelihood Office",
                "description": "LGU-led livelihood partner providing local skills training programs.",
                "category": "Livelihood",
                "contactEmail": "contact@livelihoods.org",
                "contactPhone": "+919876543211",
                "address": "Kabankalan City, Negros Occidental, Philippines",
                "status": "Pending",
                "createdAt": now_iso,
            },
            {
                "id": "partner-3",
                "name": "Philippine Business for Social Progress",
                "description": "Private-sector led foundation focused on inclusive development and CSR programs.",
                "category": "Other",
                "contactEmail": "partnerships@pbsp.org.ph",
                "contactPhone": "+63 2 8818 8678",
                "address": "Makati City, Metro Manila, Philippines",
                "status": "Approved",
                "validatedBy": "admin-1",
                "validatedAt": now_iso,
                "createdAt": now_iso,
            },
            {
                "id": "partner-4",
                "name": "Jollibee Group Foundation",
                "description": "Foundation of Jollibee Group supporting education, agriculture, and food security programs.",
                "category": "Nutrition",
                "contactEmail": "partnerships@jollibeefoundation.org",
                "contactPhone": "+63 2 8634 1111",
                "address": "Pasig City, Metro Manila, Philippines",
                "status": "Approved",
                "validatedBy": "admin-1",
                "validatedAt": now_iso,
                "createdAt": now_iso,
            },
        ],
        "projects": [
            {
                "id": "project-1",
                "title": "Mingo for Nutritional Support",
                "description": "Nutrition program focused on serving Mingo meals to undernourished children and improving child wellness outcomes.",
                "partnerId": "partner-3",
                "isEvent": False,
                "status": "In Progress",
                "category": "Nutrition",
                "startDate": _iso(2026, 1, 6),
                "endDate": _iso(2026, 11, 28),
                "location": {
                    "latitude": 10.6765,
                    "longitude": 122.9509,
                    "address": "Bacolod City, Negros Occidental, Philippines",
                },
                "volunteersNeeded": 24,
                "volunteers": ["volunteer-1"],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
            },
            {
                "id": "project-2",
                "title": "Farm to Fork Program",
                "description": "Nutrition-linked sourcing initiative that supports local farmers while supplying ingredients and food products for feeding efforts.",
                "partnerId": "partner-2",
                "isEvent": False,
                "status": "In Progress",
                "category": "Nutrition",
                "startDate": _iso(2026, 1, 20),
                "endDate": _iso(2026, 10, 30),
                "location": {
                    "latitude": 10.5333,
                    "longitude": 122.8333,
                    "address": "Pulupandan, Negros Occidental, Philippines",
                },
                "volunteersNeeded": 14,
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
            },
            {
                "id": "project-3",
                "title": "Mingo for Emergency Relief",
                "description": "Emergency response program using Mingo as a ready nutrition intervention for disaster-affected families.",
                "partnerId": "partner-3",
                "isEvent": False,
                "status": "Planning",
                "category": "Nutrition",
                "startDate": _iso(2026, 2, 10),
                "endDate": _iso(2026, 12, 15),
                "location": {
                    "latitude": 10.6667,
                    "longitude": 122.9667,
                    "address": "Talisay City, Negros Occidental, Philippines",
                },
                "volunteersNeeded": 18,
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
            },
            {
                "id": "project-4",
                "title": "Masiglang Pagbubuntis, Masiglang Kamusmusan",
                "description": "PBSP-led maternal nutrition and early childhood support program for pregnant women.",
                "partnerId": "partner-3",
                "isEvent": False,
                "status": "In Progress",
                "category": "Nutrition",
                "startDate": _iso(2026, 5, 1),
                "endDate": _iso(2026, 10, 30),
                "location": {
                    "latitude": 14.5547,
                    "longitude": 121.0244,
                    "address": "Makati City, Metro Manila, Philippines",
                },
                "volunteersNeeded": 15,
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
            },
            {
                "id": "project-5",
                "title": "Mingo Parties!",
                "description": "Community activation program that turns nutrition sessions into child-friendly outreach events using Mingo meals and learning activities.",
                "partnerId": "partner-3",
                "isEvent": True,
                "status": "Planning",
                "category": "Nutrition",
                "startDate": _iso(2026, 6, 14),
                "endDate": _iso(2026, 6, 14),
                "location": {
                    "latitude": 10.6311,
                    "longitude": 122.9784,
                    "address": "Silay City, Negros Occidental, Philippines",
                },
                "volunteersNeeded": 30,
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
            },
            {
                "id": "project-6",
                "title": "LoveBags",
                "description": "Education support drive that distributes school bags and learning supplies to students from underserved communities.",
                "partnerId": "partner-3",
                "isEvent": False,
                "status": "In Progress",
                "category": "Education",
                "startDate": _iso(2026, 1, 13),
                "endDate": _iso(2026, 8, 29),
                "location": {
                    "latitude": 10.1042,
                    "longitude": 122.8682,
                    "address": "Binalbagan, Negros Occidental, Philippines",
                },
                "volunteersNeeded": 20,
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
            },
            {
                "id": "project-7",
                "title": "School Support",
                "description": "Education improvement program covering classroom repairs, school equipment, and student learning support.",
                "partnerId": "partner-3",
                "isEvent": False,
                "status": "Planning",
                "category": "Education",
                "startDate": _iso(2026, 2, 2),
                "endDate": _iso(2026, 11, 20),
                "location": {
                    "latitude": 10.1078,
                    "longitude": 123.0111,
                    "address": "Victorias City, Negros Occidental, Philippines",
                },
                "volunteersNeeded": 16,
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
            },
            {
                "id": "project-8",
                "title": "Artisans of Hope",
                "description": "Livelihood program that helps community artisans produce and sell handcrafted items for sustainable income.",
                "partnerId": "partner-3",
                "isEvent": False,
                "status": "In Progress",
                "category": "Livelihood",
                "startDate": _iso(2026, 1, 27),
                "endDate": _iso(2026, 9, 25),
                "location": {
                    "latitude": 9.9904,
                    "longitude": 122.8144,
                    "address": "Kabankalan City, Negros Occidental, Philippines",
                },
                "volunteersNeeded": 12,
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
            },
            {
                "id": "project-9",
                "title": "Project Joseph",
                "description": "Livelihood assistance project that provides tools and starter equipment to skilled workers and breadwinners.",
                "partnerId": "partner-3",
                "isEvent": False,
                "status": "Planning",
                "category": "Livelihood",
                "startDate": _iso(2026, 3, 9),
                "endDate": _iso(2026, 11, 13),
                "location": {
                    "latitude": 10.4302,
                    "longitude": 122.9212,
                    "address": "La Carlota City, Negros Occidental, Philippines",
                },
                "volunteersNeeded": 10,
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
            },
            {
                "id": "project-10",
                "title": "Growing Hope",
                "description": "Community gardening and food security initiative that helps families grow produce for consumption and income.",
                "partnerId": "partner-3",
                "isEvent": False,
                "status": "In Progress",
                "category": "Livelihood",
                "startDate": _iso(2026, 2, 16),
                "endDate": _iso(2026, 12, 4),
                "location": {
                    "latitude": 10.3986,
                    "longitude": 122.9861,
                    "address": "Bago City, Negros Occidental, Philippines",
                },
                "volunteersNeeded": 22,
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
            },
            {
                "id": "project-11",
                "title": "Peter Project",
                "description": "Livelihood support for fisherfolk through boat assistance and market access for their catch.",
                "partnerId": "partner-3",
                "isEvent": False,
                "status": "Planning",
                "category": "Livelihood",
                "startDate": _iso(2026, 3, 23),
                "endDate": _iso(2026, 12, 11),
                "location": {
                    "latitude": 10.4989,
                    "longitude": 122.8167,
                    "address": "Valladolid, Negros Occidental, Philippines",
                },
                "volunteersNeeded": 15,
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
            },
        ],
        "volunteers": [
            {
                "id": "volunteer-1",
                "userId": "volunteer-1",
                "name": "Volunteer Account",
                "email": "volunteer@example.com",
                "phone": "+0987654321",
                "skills": ["Teaching", "Mentoring", "Community Outreach"],
                "skillsDescription": "I can support reading sessions, mentor students, organize community outreach, and help with event coordination.",
                "availability": {
                    "daysPerWeek": 3,
                    "hoursPerWeek": 12,
                    "availableDays": ["Monday", "Wednesday", "Saturday"],
                },
                "pastProjects": [],
                "totalHoursContributed": 24,
                "rating": 4.5,
                "engagementStatus": "Open to Volunteer",
                "background": "Software Engineer with passion for education",
                "createdAt": now_iso,
            }
        ],
        "messages": [
            {
                "id": "msg-seed-admin",
                "senderId": "admin-1",
                "recipientId": "volunteer-1",
                "content": "Welcome to Volcre!",
                "timestamp": (now - timedelta(minutes=1)).isoformat(),
                "read": False,
            },
            {
                "id": "msg-seed-volunteer",
                "senderId": "volunteer-1",
                "recipientId": "admin-1",
                "content": "Thank you! Glad to be part of the team.",
                "timestamp": (now - timedelta(seconds=30)).isoformat(),
                "read": False,
            },
        ],
        "statusUpdates": [
            {
                "id": "status-1",
                "projectId": "project-1",
                "status": "In Progress",
                "description": "Construction of library shelves completed",
                "updatedBy": "admin-1",
                "updatedAt": now_iso,
            }
        ],
        "volunteerMatches": [],
        "volunteerTimeLogs": [],
        "volunteerProjectJoins": [],
        "partnerProjectApplications": [],
    }


def ensure_app_storage_table() -> None:
    if get_db_mode() == "postgres":
        with get_postgres_connection() as connection:
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
        return

    with get_sqlite_connection() as connection:
        connection.execute(
            """
            create table if not exists app_storage (
              key text primary key,
              value text,
              updated_at text not null default current_timestamp
            )
            """
        )
        connection.commit()


def ensure_app_storage_seeded() -> None:
    ensure_app_storage_table()
    demo_storage = build_demo_app_storage()

    if get_db_mode() == "postgres":
        with get_postgres_connection() as connection:
            with connection.cursor() as cursor:
                for key, value in demo_storage.items():
                    cursor.execute(
                        """
                        insert into app_storage (key, value, updated_at)
                        values (%s, %s::jsonb, now())
                        on conflict (key) do nothing
                        """,
                        (key, json.dumps(value)),
                    )
            connection.commit()
        return

    with get_sqlite_connection() as connection:
        for key, value in demo_storage.items():
            connection.execute(
                """
                insert or ignore into app_storage (key, value, updated_at)
                values (?, ?, current_timestamp)
                """,
                (key, json.dumps(value)),
            )
        connection.commit()


def main() -> None:
    ensure_app_storage_seeded()
    print("App storage demo data ensured.")


if __name__ == "__main__":
    main()
