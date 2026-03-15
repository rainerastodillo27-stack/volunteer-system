import json
from datetime import datetime, timezone

from db import get_connection


def iso(year: int, month: int, day: int) -> str:
    return datetime(year, month, day).isoformat()


NOW = datetime.now(timezone.utc).isoformat()

USERS = [
    {
        "id": "admin-1",
        "email": "admin@nvc.org",
        "password": "admin123",
        "role": "admin",
        "name": "NVC Admin Account",
        "phone": "+63 917 000 0001",
        "created_at": NOW,
    },
    {
        "id": "volunteer-1",
        "email": "volunteer@example.com",
        "password": "volunteer123",
        "role": "volunteer",
        "name": "Volunteer Account",
        "phone": "+0987654321",
        "created_at": NOW,
    },
    {
        "id": "partner-user-1",
        "email": "partner@livelihoods.org",
        "password": "partner123",
        "role": "partner",
        "name": "Partner Org Account",
        "phone": "+919876543211",
        "created_at": NOW,
    },
    {
        "id": "partner-user-2",
        "email": "partnerships@pbsp.org.ph",
        "password": "partner123",
        "role": "partner",
        "name": "PBSP Account",
        "phone": "+63 2 8818 8678",
        "created_at": NOW,
    },
    {
        "id": "partner-user-3",
        "email": "partnerships@jollibeefoundation.org",
        "password": "partner123",
        "role": "partner",
        "name": "Jollibee Foundation Account",
        "phone": "+63 2 8634 1111",
        "created_at": NOW,
    },
]

PARTNERS = [
    {
        "id": "partner-2",
        "name": "LGU Kabankalan Livelihood Office",
        "description": "LGU-led livelihood partner providing local skills training programs.",
        "category": "Livelihood",
        "contact_email": "contact@livelihoods.org",
        "contact_phone": "+919876543211",
        "address": "Kabankalan City, Negros Occidental, Philippines",
        "status": "Pending",
        "validated_by": None,
        "validated_at": None,
        "created_at": NOW,
        "registration_documents": [],
    },
    {
        "id": "partner-3",
        "name": "Philippine Business for Social Progress",
        "description": "Private-sector led foundation focused on inclusive development and CSR programs.",
        "category": "Other",
        "contact_email": "partnerships@pbsp.org.ph",
        "contact_phone": "+63 2 8818 8678",
        "address": "Makati City, Metro Manila, Philippines",
        "status": "Approved",
        "validated_by": "admin-1",
        "validated_at": NOW,
        "created_at": NOW,
        "registration_documents": [],
    },
    {
        "id": "partner-4",
        "name": "Jollibee Group Foundation",
        "description": "Foundation of Jollibee Group supporting education, agriculture, and food security programs.",
        "category": "Nutrition",
        "contact_email": "partnerships@jollibeefoundation.org",
        "contact_phone": "+63 2 8634 1111",
        "address": "Pasig City, Metro Manila, Philippines",
        "status": "Approved",
        "validated_by": "admin-1",
        "validated_at": NOW,
        "created_at": NOW,
        "registration_documents": [],
    },
]

PROJECTS = [
    {
        "id": "project-1",
        "title": "Mingo for Nutritional Support",
        "description": "Nutrition program focused on serving Mingo meals to undernourished children and improving child wellness outcomes.",
        "partner_id": "partner-3",
        "is_event": False,
        "status": "In Progress",
        "category": "Nutrition",
        "start_date": iso(2026, 1, 6),
        "end_date": iso(2026, 11, 28),
        "location": {"latitude": 10.6765, "longitude": 122.9509, "address": "Bacolod City, Negros Occidental, Philippines"},
        "volunteers_needed": 24,
        "volunteers": ["volunteer-1"],
        "joined_user_ids": [],
        "created_at": NOW,
        "updated_at": NOW,
        "status_updates": [],
    },
    {
        "id": "project-2",
        "title": "Farm to Fork Program",
        "description": "Nutrition-linked sourcing initiative that supports local farmers while supplying ingredients and food products for feeding efforts.",
        "partner_id": "partner-2",
        "is_event": False,
        "status": "In Progress",
        "category": "Nutrition",
        "start_date": iso(2026, 1, 20),
        "end_date": iso(2026, 10, 30),
        "location": {"latitude": 10.5333, "longitude": 122.8333, "address": "Pulupandan, Negros Occidental, Philippines"},
        "volunteers_needed": 14,
        "volunteers": [],
        "joined_user_ids": [],
        "created_at": NOW,
        "updated_at": NOW,
        "status_updates": [],
    },
    {
        "id": "project-3",
        "title": "Mingo for Emergency Relief",
        "description": "Emergency response program using Mingo as a ready nutrition intervention for disaster-affected families.",
        "partner_id": "partner-3",
        "is_event": False,
        "status": "Planning",
        "category": "Nutrition",
        "start_date": iso(2026, 2, 10),
        "end_date": iso(2026, 12, 15),
        "location": {"latitude": 10.6667, "longitude": 122.9667, "address": "Talisay City, Negros Occidental, Philippines"},
        "volunteers_needed": 18,
        "volunteers": [],
        "joined_user_ids": [],
        "created_at": NOW,
        "updated_at": NOW,
        "status_updates": [],
    },
    {
        "id": "project-4",
        "title": "Masiglang Pagbubuntis, Masiglang Kamusmusan",
        "description": "PBSP-led maternal nutrition and early childhood support program for pregnant women.",
        "partner_id": "partner-3",
        "is_event": False,
        "status": "In Progress",
        "category": "Nutrition",
        "start_date": iso(2026, 5, 1),
        "end_date": iso(2026, 10, 30),
        "location": {"latitude": 14.5547, "longitude": 121.0244, "address": "Makati City, Metro Manila, Philippines"},
        "volunteers_needed": 15,
        "volunteers": [],
        "joined_user_ids": [],
        "created_at": NOW,
        "updated_at": NOW,
        "status_updates": [],
    },
    {
        "id": "project-5",
        "title": "Mingo Parties!",
        "description": "Community activation program that turns nutrition sessions into child-friendly outreach events using Mingo meals and learning activities.",
        "partner_id": "partner-3",
        "is_event": True,
        "status": "Planning",
        "category": "Nutrition",
        "start_date": iso(2026, 6, 14),
        "end_date": iso(2026, 6, 14),
        "location": {"latitude": 10.6311, "longitude": 122.9784, "address": "Silay City, Negros Occidental, Philippines"},
        "volunteers_needed": 30,
        "volunteers": [],
        "joined_user_ids": [],
        "created_at": NOW,
        "updated_at": NOW,
        "status_updates": [],
    },
    {
        "id": "project-6",
        "title": "LoveBags",
        "description": "Education support drive that distributes school bags and learning supplies to students from underserved communities.",
        "partner_id": "partner-3",
        "is_event": False,
        "status": "In Progress",
        "category": "Education",
        "start_date": iso(2026, 1, 13),
        "end_date": iso(2026, 8, 29),
        "location": {"latitude": 10.1042, "longitude": 122.8682, "address": "Binalbagan, Negros Occidental, Philippines"},
        "volunteers_needed": 20,
        "volunteers": [],
        "joined_user_ids": [],
        "created_at": NOW,
        "updated_at": NOW,
        "status_updates": [],
    },
    {
        "id": "project-7",
        "title": "School Support",
        "description": "Education improvement program covering classroom repairs, school equipment, and student learning support.",
        "partner_id": "partner-3",
        "is_event": False,
        "status": "Planning",
        "category": "Education",
        "start_date": iso(2026, 2, 2),
        "end_date": iso(2026, 11, 20),
        "location": {"latitude": 10.1078, "longitude": 123.0111, "address": "Victorias City, Negros Occidental, Philippines"},
        "volunteers_needed": 16,
        "volunteers": [],
        "joined_user_ids": [],
        "created_at": NOW,
        "updated_at": NOW,
        "status_updates": [],
    },
    {
        "id": "project-8",
        "title": "Artisans of Hope",
        "description": "Livelihood program that helps community artisans produce and sell handcrafted items for sustainable income.",
        "partner_id": "partner-3",
        "is_event": False,
        "status": "In Progress",
        "category": "Livelihood",
        "start_date": iso(2026, 1, 27),
        "end_date": iso(2026, 9, 25),
        "location": {"latitude": 9.9904, "longitude": 122.8144, "address": "Kabankalan City, Negros Occidental, Philippines"},
        "volunteers_needed": 12,
        "volunteers": [],
        "joined_user_ids": [],
        "created_at": NOW,
        "updated_at": NOW,
        "status_updates": [],
    },
    {
        "id": "project-9",
        "title": "Project Joseph",
        "description": "Livelihood assistance project that provides tools and starter equipment to skilled workers and breadwinners.",
        "partner_id": "partner-3",
        "is_event": False,
        "status": "Planning",
        "category": "Livelihood",
        "start_date": iso(2026, 3, 9),
        "end_date": iso(2026, 11, 13),
        "location": {"latitude": 10.4302, "longitude": 122.9212, "address": "La Carlota City, Negros Occidental, Philippines"},
        "volunteers_needed": 10,
        "volunteers": [],
        "joined_user_ids": [],
        "created_at": NOW,
        "updated_at": NOW,
        "status_updates": [],
    },
    {
        "id": "project-10",
        "title": "Growing Hope",
        "description": "Community gardening and food security initiative that helps families grow produce for consumption and income.",
        "partner_id": "partner-3",
        "is_event": False,
        "status": "In Progress",
        "category": "Livelihood",
        "start_date": iso(2026, 2, 16),
        "end_date": iso(2026, 12, 4),
        "location": {"latitude": 10.3986, "longitude": 122.9861, "address": "Bago City, Negros Occidental, Philippines"},
        "volunteers_needed": 22,
        "volunteers": [],
        "joined_user_ids": [],
        "created_at": NOW,
        "updated_at": NOW,
        "status_updates": [],
    },
    {
        "id": "project-11",
        "title": "Peter Project",
        "description": "Livelihood support for fisherfolk through boat assistance and market access for their catch.",
        "partner_id": "partner-3",
        "is_event": False,
        "status": "Planning",
        "category": "Livelihood",
        "start_date": iso(2026, 3, 23),
        "end_date": iso(2026, 12, 11),
        "location": {"latitude": 10.4989, "longitude": 122.8167, "address": "Valladolid, Negros Occidental, Philippines"},
        "volunteers_needed": 15,
        "volunteers": [],
        "joined_user_ids": [],
        "created_at": NOW,
        "updated_at": NOW,
        "status_updates": [],
    },
]

VOLUNTEERS = [
    {
        "id": "volunteer-profile-1",
        "user_id": "volunteer-1",
        "name": "Volunteer Account",
        "email": "volunteer@example.com",
        "phone": "+0987654321",
        "skills": ["community outreach", "feeding", "education support"],
        "skills_description": "Comfortable with outreach, beneficiary support, and field coordination.",
        "availability": {
            "daysPerWeek": 3,
            "hoursPerWeek": 12,
            "availableDays": ["Monday", "Wednesday", "Saturday"],
        },
        "past_projects": [],
        "total_hours_contributed": 0,
        "rating": 5,
        "engagement_status": "Open to Volunteer",
        "background": "Volunteer interested in nutrition and education programs.",
        "created_at": NOW,
    }
]


def run_many(cursor, statement: str, rows: list[tuple]) -> None:
    for row in rows:
        cursor.execute(statement, row)


def main() -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            run_many(
                cursor,
                """
                insert into app_users (id, email, password, role, name, phone, created_at)
                values (%s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                  email = excluded.email,
                  password = excluded.password,
                  role = excluded.role,
                  name = excluded.name,
                  phone = excluded.phone
                """,
                [
                    (
                        user["id"],
                        user["email"],
                        user["password"],
                        user["role"],
                        user["name"],
                        user["phone"],
                        user["created_at"],
                    )
                    for user in USERS
                ],
            )

            run_many(
                cursor,
                """
                insert into partners (
                  id, name, description, category, contact_email, contact_phone,
                  address, status, validated_by, validated_at, created_at, registration_documents
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                on conflict (id) do update set
                  name = excluded.name,
                  description = excluded.description,
                  category = excluded.category,
                  contact_email = excluded.contact_email,
                  contact_phone = excluded.contact_phone,
                  address = excluded.address,
                  status = excluded.status,
                  validated_by = excluded.validated_by,
                  validated_at = excluded.validated_at,
                  registration_documents = excluded.registration_documents
                """,
                [
                    (
                        partner["id"],
                        partner["name"],
                        partner["description"],
                        partner["category"],
                        partner["contact_email"],
                        partner["contact_phone"],
                        partner["address"],
                        partner["status"],
                        partner["validated_by"],
                        partner["validated_at"],
                        partner["created_at"],
                        json.dumps(partner["registration_documents"]),
                    )
                    for partner in PARTNERS
                ],
            )

            run_many(
                cursor,
                """
                insert into projects (
                  id, title, description, partner_id, is_event, status, category,
                  start_date, end_date, location, volunteers_needed, volunteers,
                  joined_user_ids, created_at, updated_at, status_updates
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s::jsonb, %s, %s, %s::jsonb)
                on conflict (id) do update set
                  title = excluded.title,
                  description = excluded.description,
                  partner_id = excluded.partner_id,
                  is_event = excluded.is_event,
                  status = excluded.status,
                  category = excluded.category,
                  start_date = excluded.start_date,
                  end_date = excluded.end_date,
                  location = excluded.location,
                  volunteers_needed = excluded.volunteers_needed,
                  volunteers = excluded.volunteers,
                  joined_user_ids = excluded.joined_user_ids,
                  updated_at = excluded.updated_at,
                  status_updates = excluded.status_updates
                """,
                [
                    (
                        project["id"],
                        project["title"],
                        project["description"],
                        project["partner_id"],
                        project["is_event"],
                        project["status"],
                        project["category"],
                        project["start_date"],
                        project["end_date"],
                        json.dumps(project["location"]),
                        project["volunteers_needed"],
                        json.dumps(project["volunteers"]),
                        json.dumps(project["joined_user_ids"]),
                        project["created_at"],
                        project["updated_at"],
                        json.dumps(project["status_updates"]),
                    )
                    for project in PROJECTS
                ],
            )

            run_many(
                cursor,
                """
                insert into volunteers (
                  id, user_id, name, email, phone, skills, skills_description,
                  availability, past_projects, total_hours_contributed, rating,
                  engagement_status, background, created_at
                )
                values (%s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s::jsonb, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                  user_id = excluded.user_id,
                  name = excluded.name,
                  email = excluded.email,
                  phone = excluded.phone,
                  skills = excluded.skills,
                  skills_description = excluded.skills_description,
                  availability = excluded.availability,
                  past_projects = excluded.past_projects,
                  total_hours_contributed = excluded.total_hours_contributed,
                  rating = excluded.rating,
                  engagement_status = excluded.engagement_status,
                  background = excluded.background
                """,
                [
                    (
                        volunteer["id"],
                        volunteer["user_id"],
                        volunteer["name"],
                        volunteer["email"],
                        volunteer["phone"],
                        json.dumps(volunteer["skills"]),
                        volunteer["skills_description"],
                        json.dumps(volunteer["availability"]),
                        json.dumps(volunteer["past_projects"]),
                        volunteer["total_hours_contributed"],
                        volunteer["rating"],
                        volunteer["engagement_status"],
                        volunteer["background"],
                        volunteer["created_at"],
                    )
                    for volunteer in VOLUNTEERS
                ],
            )
        connection.commit()

    print("Supabase demo data seeded.")


if __name__ == "__main__":
    main()
