from typing import Any

try:
    from .field_rules import normalize_email, sanitize_hot_storage_item
    from .relational_mirror import sync_relational_mirror_collection
    from .storage_table_contract import KNOWN_ROGUE_TABLES, LEGACY_COMPAT_STORAGE_TABLES
except ImportError:
    from field_rules import normalize_email, sanitize_hot_storage_item
    from relational_mirror import sync_relational_mirror_collection
    from storage_table_contract import KNOWN_ROGUE_TABLES, LEGACY_COMPAT_STORAGE_TABLES

ROGUE_TABLES = list(KNOWN_ROGUE_TABLES)
HOT_STORAGE_TABLES = dict(LEGACY_COMPAT_STORAGE_TABLES)
DATA_QUALITY_CONSTRAINT_SPECS = [
    ("app_users", "app_users_id_len_chk", "length(app_users_id) between 1 and 64"),
    ("app_users", "app_users_email_format_chk", "email is not null and length(email) <= 254 and email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'"),
    ("app_users", "app_users_password_len_chk", "length(password) between 1 and 128"),
    ("app_users", "app_users_phone_mobile_chk", "phone is null or phone ~ '^09[0-9]{9}$'"),
    ("app_users", "app_users_name_len_chk", "length(name) between 1 and 120"),
    ("app_users", "app_users_role_chk", "role in ('admin', 'volunteer', 'partner')"),
    ("users", "users_id_len_chk", "length(id) between 1 and 64"),
    ("users", "users_email_format_chk", "email is null or (length(email) <= 254 and email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')"),
    ("users", "users_password_len_chk", "length(password) between 1 and 128"),
    ("users", "users_phone_mobile_chk", "phone is null or phone ~ '^09[0-9]{9}$'"),
    ("users", "users_name_len_chk", "length(name) between 1 and 120"),
    ("users", "users_role_chk", "role in ('admin', 'volunteer', 'partner')"),
    ("users", "users_user_type_chk", "user_type is null or user_type in ('Student', 'Adult', 'Senior')"),
    ("partners", "partners_id_len_chk", "length(id) between 1 and 64"),
    ("partners", "partners_contact_email_format_chk", "contact_email is null or (length(contact_email) <= 254 and contact_email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')"),
    ("partners", "partners_contact_phone_chk", "contact_phone is null or contact_phone ~ '^(09[0-9]{9}|\\+63[0-9]{9,11})$'"),
    ("partners", "partners_name_len_chk", "length(name) between 1 and 120"),
    ("partners", "partners_description_len_chk", "description is null or length(description) <= 2000"),
    ("partners", "partners_address_len_chk", "address is null or length(address) <= 255"),
    ("partners", "partners_dswd_len_chk", "dswd_accreditation_no is null or length(dswd_accreditation_no) <= 60"),
    ("partners", "partners_sec_len_chk", "sec_registration_no is null or length(sec_registration_no) <= 60"),
    ("partners", "partners_status_chk", "status is null or status in ('Pending', 'Approved', 'Rejected')"),
    ("partners", "partners_verification_status_chk", "verification_status is null or verification_status in ('Pending', 'Verified')"),
    ("partners", "partners_category_chk", "category is null or category in ('Education', 'Livelihood', 'Nutrition', 'Disaster')"),
    ("partners", "partners_sector_type_chk", "sector_type is null or sector_type in ('NGO', 'Hospital', 'Institution', 'Private')"),
    ("partners", "partners_verification_notes_len_chk", "verification_notes is null or length(verification_notes) <= 1000"),
    ("volunteers", "volunteers_id_len_chk", "length(id) between 1 and 64"),
    ("volunteers", "volunteers_email_format_chk", "email is null or (length(email) <= 254 and email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')"),
    ("volunteers", "volunteers_phone_mobile_chk", "phone is null or phone ~ '^09[0-9]{9}$'"),
    ("volunteers", "volunteers_hours_non_negative_chk", "total_hours_contributed >= 0"),
    ("volunteers", "volunteers_rating_range_chk", "rating >= 0 and rating <= 5"),
    ("volunteers", "volunteers_registration_status_chk", "registration_status is null or registration_status in ('Pending', 'Approved', 'Rejected')"),
    ("volunteers", "volunteers_engagement_status_chk", "engagement_status is null or engagement_status in ('Open to Volunteer', 'Busy')"),
    ("volunteers", "volunteers_name_len_chk", "length(name) between 1 and 120"),
    ("volunteers", "volunteers_skills_description_len_chk", "skills_description is null or length(skills_description) <= 500"),
    ("volunteers", "volunteers_background_len_chk", "background is null or length(background) <= 2000"),
    ("volunteers", "volunteers_gender_len_chk", "gender is null or length(gender) <= 50"),
    ("volunteers", "volunteers_civil_status_len_chk", "civil_status is null or length(civil_status) <= 50"),
    ("volunteers", "volunteers_home_address_len_chk", "home_address is null or length(home_address) <= 255"),
    ("volunteers", "volunteers_home_region_len_chk", "home_address_region is null or length(home_address_region) <= 120"),
    ("volunteers", "volunteers_home_city_len_chk", "home_address_city_municipality is null or length(home_address_city_municipality) <= 120"),
    ("volunteers", "volunteers_home_barangay_len_chk", "home_address_barangay is null or length(home_address_barangay) <= 120"),
    ("volunteers", "volunteers_occupation_len_chk", "occupation is null or length(occupation) <= 120"),
    ("volunteers", "volunteers_workplace_len_chk", "workplace_or_school is null or length(workplace_or_school) <= 120"),
    ("volunteers", "volunteers_college_course_len_chk", "college_course is null or length(college_course) <= 120"),
    ("volunteers", "volunteers_certifications_len_chk", "certifications_or_trainings is null or length(certifications_or_trainings) <= 1000"),
    ("volunteers", "volunteers_hobbies_len_chk", "hobbies_and_interests is null or length(hobbies_and_interests) <= 1000"),
    ("volunteers", "volunteers_special_skills_len_chk", "special_skills is null or length(special_skills) <= 1000"),
    ("volunteers", "volunteers_video_url_len_chk", "video_briefing_url is null or length(video_briefing_url) <= 500"),
    ("projects", "projects_id_len_chk", "length(id) between 1 and 64"),
    ("projects", "projects_volunteers_needed_chk", "volunteers_needed >= 0"),
    ("projects", "projects_status_chk", "status is null or status in ('Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled')"),
    ("projects", "projects_category_chk", "category is null or category in ('Education', 'Livelihood', 'Nutrition', 'Disaster')"),
    ("projects", "projects_program_module_chk", "program_module is null or program_module in ('Education', 'Livelihood', 'Nutrition', 'Disaster')"),
    ("projects", "projects_title_len_chk", "length(title) between 1 and 150"),
    ("projects", "projects_description_len_chk", "description is null or length(description) <= 3000"),
    ("status_updates", "status_updates_id_len_chk", "length(id) between 1 and 64"),
    ("status_updates", "status_updates_status_chk", "status is null or status in ('Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled')"),
    ("status_updates", "status_updates_description_len_chk", "description is null or length(description) <= 1500"),
    ("status_updates", "status_updates_updated_by_len_chk", "updated_by is null or length(updated_by) <= 64"),
    ("volunteer_matches", "volunteer_matches_id_len_chk", "length(id) between 1 and 64"),
    ("volunteer_matches", "volunteer_matches_status_chk", "status is null or status in ('Requested', 'Matched', 'Completed', 'Cancelled', 'Rejected')"),
    ("volunteer_matches", "volunteer_matches_hours_non_negative_chk", "hours_contributed >= 0"),
    ("volunteer_matches", "volunteer_matches_reviewed_by_len_chk", "reviewed_by is null or length(reviewed_by) <= 64"),
    ("volunteer_time_logs", "volunteer_time_logs_id_len_chk", "length(id) between 1 and 64"),
    ("volunteer_time_logs", "volunteer_time_logs_note_len_chk", "note is null or length(note) <= 1000"),
    ("volunteer_time_logs", "volunteer_time_logs_completion_photo_len_chk", "completion_photo is null or length(completion_photo) <= 500"),
    ("volunteer_time_logs", "volunteer_time_logs_completion_report_len_chk", "completion_report is null or length(completion_report) <= 500"),
    ("volunteer_event_joins", "volunteer_event_joins_id_len_chk", "length(id) between 1 and 64"),
    ("volunteer_event_joins", "volunteer_event_joins_volunteer_name_len_chk", "volunteer_name is null or length(volunteer_name) <= 120"),
    ("volunteer_event_joins", "volunteer_event_joins_volunteer_email_chk", "volunteer_email is null or volunteer_email = '' or (length(volunteer_email) <= 254 and volunteer_email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')"),
    ("volunteer_event_joins", "volunteer_event_joins_source_chk", "source is null or source in ('VolunteerJoin', 'AdminMatch')"),
    ("volunteer_event_joins", "volunteer_event_joins_participation_status_chk", "participation_status is null or participation_status in ('Active', 'Completed')"),
    ("volunteer_event_joins", "volunteer_event_joins_completed_by_len_chk", "completed_by is null or length(completed_by) <= 64"),
    ("partner_project_applications", "partner_project_applications_id_len_chk", "length(id) between 1 and 64"),
    ("partner_project_applications", "partner_project_applications_status_chk", "status is null or status in ('Pending', 'Approved', 'Rejected')"),
    ("partner_project_applications", "partner_project_applications_partner_name_len_chk", "partner_name is null or length(partner_name) <= 120"),
    ("partner_project_applications", "partner_project_applications_partner_email_chk", "partner_email is null or partner_email = '' or (length(partner_email) <= 254 and partner_email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')"),
    ("partner_project_applications", "partner_project_applications_reviewed_by_len_chk", "reviewed_by is null or length(reviewed_by) <= 64"),
    ("reports", "reports_id_len_chk", "length(id) between 1 and 64"),
    ("reports", "reports_status_chk", "status is null or status in ('Submitted', 'Reviewed')"),
    ("reports", "reports_impact_count_chk", "impact_count >= 0"),
    ("reports", "reports_partner_name_len_chk", "partner_name is null or length(partner_name) <= 120"),
    ("reports", "reports_submitter_name_len_chk", "submitter_name is null or length(submitter_name) <= 120"),
    ("reports", "reports_submitter_role_chk", "submitter_role is null or submitter_role in ('admin', 'volunteer', 'partner')"),
    ("reports", "reports_title_len_chk", "title is null or length(title) <= 150"),
    ("reports", "reports_report_type_chk", "report_type is null or report_type in ('General', 'Medical', 'Logistics', 'volunteer_engagement', 'field_report', 'program_impact', 'event_performance', 'partner_collaboration', 'system_metrics')"),
    ("reports", "reports_description_len_chk", "description is null or length(description) <= 3000"),
    ("reports", "reports_media_file_len_chk", "media_file is null or length(media_file) <= 500"),
    ("reports", "reports_format_chk", "format is null or format in ('PDF', 'Excel')"),
    ("reports", "reports_report_file_len_chk", "report_file is null or length(report_file) <= 500"),
    ("reports", "reports_generated_by_len_chk", "generated_by is null or length(generated_by) <= 64"),
    ("messages", "messages_id_len_chk", "length(messages_id) between 1 and 64"),
    ("messages", "messages_content_len_chk", "length(content) between 1 and 4000"),
    ("project_group_messages", "project_group_messages_id_len_chk", "length(project_group_messages_id) between 1 and 64"),
    ("project_group_messages", "project_group_messages_content_len_chk", "length(content) between 1 and 4000"),
]


def _public_table_exists(connection: Any, table_name: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select exists (
              select 1
              from information_schema.tables
              where table_schema = 'public' and table_name = %s
            )
            """,
            (table_name,),
        )
        row = cursor.fetchone()
    return bool(row and row[0])


def _public_table_column_exists(connection: Any, table_name: str, column_name: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select exists (
              select 1
              from information_schema.columns
              where table_schema = 'public'
                and table_name = %s
                and column_name = %s
            )
            """,
            (table_name, column_name),
        )
        row = cursor.fetchone()
    return bool(row and row[0])


def migrate_legacy_report_tables_to_reports(connection: Any) -> list[str]:
    if not _public_table_exists(connection, "reports"):
        return []

    migration_notes: list[str] = []

    with connection.cursor() as cursor:
        if _public_table_exists(connection, "partner_reports"):
            cursor.execute(
                """
                insert into reports (
                  id,
                  project_id,
                  partner_id,
                  partner_user_id,
                  partner_name,
                  submitter_user_id,
                  submitter_name,
                  submitter_role,
                  title,
                  report_type,
                  description,
                  impact_count,
                  metrics,
                  attachments,
                  media_file,
                  created_at,
                  status,
                  reviewed_at,
                  reviewed_by,
                  generated_by,
                  generated_at,
                  report_file,
                  format,
                  published_at,
                  download_content,
                  download_mime_type,
                  source_report_ids
                )
                select
                  id,
                  project_id,
                  partner_id,
                  partner_user_id,
                  partner_name,
                  submitter_user_id,
                  submitter_name,
                  submitter_role,
                  title,
                  report_type,
                  description,
                  impact_count,
                  metrics,
                  attachments,
                  media_file,
                  created_at,
                  status,
                  reviewed_at,
                  reviewed_by,
                  null::text,
                  null::text,
                  null::text,
                  null::text,
                  null::text,
                  null::text,
                  null::text,
                  '[]'::jsonb
                from partner_reports
                on conflict (id) do nothing
                """
            )
            migrated_partner_rows = cursor.rowcount or 0
            if migrated_partner_rows:
                migration_notes.append(f"partner_reports:{migrated_partner_rows}")

        if _public_table_exists(connection, "published_impact_reports"):
            download_content_expr = (
                "download_content"
                if _public_table_column_exists(connection, "published_impact_reports", "download_content")
                else "null::text"
            )
            download_mime_type_expr = (
                "download_mime_type"
                if _public_table_column_exists(connection, "published_impact_reports", "download_mime_type")
                else "null::text"
            )
            source_report_ids_expr = (
                "source_report_ids"
                if _public_table_column_exists(connection, "published_impact_reports", "source_report_ids")
                else "'[]'::jsonb"
            )

            cursor.execute(
                f"""
                insert into reports (
                  id,
                  project_id,
                  partner_id,
                  partner_user_id,
                  partner_name,
                  submitter_user_id,
                  submitter_name,
                  submitter_role,
                  title,
                  report_type,
                  description,
                  impact_count,
                  metrics,
                  attachments,
                  media_file,
                  created_at,
                  status,
                  reviewed_at,
                  reviewed_by,
                  generated_by,
                  generated_at,
                  report_file,
                  format,
                  published_at,
                  download_content,
                  download_mime_type,
                  source_report_ids
                )
                select
                  id,
                  project_id,
                  null::text,
                  null::text,
                  null::text,
                  null::text,
                  null::text,
                  null::text,
                  null::text,
                  null::text,
                  null::text,
                  0,
                  '{{}}'::jsonb,
                  '[]'::jsonb,
                  null::text,
                  generated_at,
                  null::text,
                  null::text,
                  null::text,
                  generated_by,
                  generated_at,
                  report_file,
                  format,
                  published_at,
                  {download_content_expr},
                  {download_mime_type_expr},
                  {source_report_ids_expr}
                from published_impact_reports
                on conflict (id) do nothing
                """
            )
            migrated_published_rows = cursor.rowcount or 0
            if migrated_published_rows:
                migration_notes.append(f"published_impact_reports:{migrated_published_rows}")

    return migration_notes


def migrate_legacy_volunteer_project_joins(connection: Any) -> int:
    if not _public_table_exists(connection, "volunteer_project_joins"):
        return 0

    with connection.cursor() as cursor:
        cursor.execute(
            """
            do $$
            begin
              if not exists (
                select 1
                from information_schema.tables
                where table_schema = 'public' and table_name = 'volunteer_event_joins'
              ) then
                alter table volunteer_project_joins rename to volunteer_event_joins;
              end if;
            end $$;
            """
        )

    if not _public_table_exists(connection, "volunteer_event_joins"):
        return 0

    with connection.cursor() as cursor:
        cursor.execute(
            """
            select count(*)
            from volunteer_event_joins
            """
        )
        row = cursor.fetchone()
    return int(row[0] or 0) if row is not None else 0


def _upsert_app_storage_collection(connection: Any, key: str, items: list[dict[str, Any]]) -> None:
    if not _public_table_exists(connection, "app_storage"):
        return
    with connection.cursor() as cursor:
        cursor.execute(
            """
            insert into app_storage (key, value, updated_at)
            values (%s, %s::jsonb, now())
            on conflict (key) do update set
              value = excluded.value,
              updated_at = excluded.updated_at
            """,
            (key, __import__("json").dumps(items)),
        )


def sanitize_hot_storage_collections(connection: Any) -> dict[str, int]:
    cleaned_counts: dict[str, int] = {}

    with connection.cursor() as cursor:
        for key, table_name in HOT_STORAGE_TABLES.items():
            cursor.execute(
                """
                select exists (
                  select 1
                  from information_schema.tables
                  where table_schema = 'public' and table_name = %s
                )
                """,
                (table_name,),
            )
            if not bool(cursor.fetchone()[0]):
                continue

            cursor.execute(
                f"""
                select id, data
                from {table_name}
                order by sort_order asc, updated_at asc, id asc
                """
            )
            rows = cursor.fetchall()
            original_items = [row[1] for row in rows]
            sanitized_items = [
                sanitize_hot_storage_item(key, item)
                for item in original_items
                if isinstance(item, dict) and item.get("id")
            ]

            changed = 0
            for (item_id, _), sanitized_item in zip(rows, sanitized_items):
                if sanitized_item != _:
                    changed += 1
                    cursor.execute(
                        f"""
                        update {table_name}
                        set data = %s::jsonb, updated_at = now()
                        where id = %s
                        """,
                        (__import__("json").dumps(sanitized_item), item_id),
                    )

            if changed:
                _upsert_app_storage_collection(connection, key, sanitized_items)
                sync_relational_mirror_collection(connection, key, sanitized_items)
                cleaned_counts[key] = changed

    return cleaned_counts


def sync_legacy_app_users_from_hot_storage(connection: Any) -> int:
    if not _public_table_exists(connection, "app_users_store") or not _public_table_exists(connection, "app_users"):
        return 0

    with connection.cursor() as cursor:
        cursor.execute(
            """
            select data
            from app_users_store
            order by sort_order asc, updated_at asc, id asc
            """
        )
        users = [row[0] for row in cursor.fetchall()]
        upserted = 0

        for user in users:
            if not isinstance(user, dict) or not user.get("id"):
                continue

            email = normalize_email(user.get("email"))
            if not email:
                email = f"{user['id']}@volcre.local"

            cursor.execute(
                """
                delete from app_users
                where email = %s and app_users_id <> %s
                """,
                (email, user["id"]),
            )
            cursor.execute(
                """
                insert into app_users (app_users_id, email, password, role, name, phone, created_at)
                values (%s, %s, %s, %s, %s, %s, %s)
                on conflict (app_users_id) do update set
                  email = excluded.email,
                  password = excluded.password,
                  role = excluded.role,
                  name = excluded.name,
                  phone = excluded.phone,
                  created_at = excluded.created_at
                """,
                (
                    str(user["id"]),
                    email,
                    str(user.get("password") or ""),
                    str(user.get("role") or "volunteer"),
                    str(user.get("name") or user["id"])[:120],
                    user.get("phone"),
                    str(user.get("createdAt") or user.get("created_at") or "2000-01-01T00:00:00+00:00"),
                ),
            )
            upserted += 1

    return upserted


def _add_check_constraint(cursor: Any, table_name: str, constraint_name: str, condition: str) -> None:
    cursor.execute(
        f"""
        do $$
        begin
          if not exists (
            select 1
            from pg_constraint
            where conname = '{constraint_name}'
          ) then
            alter table {table_name}
            add constraint {constraint_name}
            check ({condition}) not valid;
          end if;
        end $$;
        """
    )


def apply_data_quality_constraints(connection: Any) -> list[str]:
    applied: list[str] = []

    existing_tables = {
        table_name
        for table_name, _, _ in DATA_QUALITY_CONSTRAINT_SPECS
        if _public_table_exists(connection, table_name)
    }

    with connection.cursor() as cursor:
        for table_name, constraint_name, condition in DATA_QUALITY_CONSTRAINT_SPECS:
            if table_name not in existing_tables:
                continue
            _add_check_constraint(cursor, table_name, constraint_name, condition)
            applied.append(constraint_name)

    return applied


def drop_empty_rogue_tables(connection: Any) -> list[str]:
    dropped_tables: list[str] = []

    with connection.cursor() as cursor:
        for table_name in ROGUE_TABLES:
            cursor.execute(
                """
                select exists (
                  select 1
                  from information_schema.tables
                  where table_schema = 'public' and table_name = %s
                )
                """,
                (table_name,),
            )
            table_exists = bool(cursor.fetchone()[0])
            if not table_exists:
                continue

            cursor.execute(f'select count(*) from "{table_name}"')
            row_count = int(cursor.fetchone()[0])
            if row_count != 0:
                continue

            cursor.execute(f'drop table if exists "{table_name}"')
            dropped_tables.append(table_name)

    return dropped_tables


def prune_stale_legacy_app_users(connection: Any) -> list[str]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select
              to_regclass('public.app_users') is not null,
              to_regclass('public.users') is not null,
              to_regclass('public.messages') is not null,
              to_regclass('public.project_group_messages') is not null
            """
        )
        app_users_exists, users_exists, messages_exists, group_messages_exists = cursor.fetchone()

        if not app_users_exists or not users_exists:
            return []

        reference_guards = ["not exists (select 1 from users u where u.id = a.app_users_id)"]
        if messages_exists:
            reference_guards.append(
                "not exists (select 1 from messages m where m.sender_id = a.app_users_id or m.recipient_id = a.app_users_id)"
            )
        if group_messages_exists:
            reference_guards.append(
                "not exists (select 1 from project_group_messages pg where pg.sender_id = a.app_users_id)"
            )

        cursor.execute(
            f"""
            select a.app_users_id
            from app_users a
            where {' and '.join(reference_guards)}
            order by a.app_users_id
            """
        )
        stale_ids = [row[0] for row in cursor.fetchall()]

        if stale_ids:
            cursor.execute("delete from app_users where app_users_id = any(%s)", (stale_ids,))

    return stale_ids


def maintain_schema_health(connection: Any) -> dict[str, list[str]]:
    try:
        from .data_archival import apply_retention_policies, enforce_max_record_limits
    except ImportError:
        from data_archival import apply_retention_policies, enforce_max_record_limits
    
    cleaned_collections = sanitize_hot_storage_collections(connection)
    sync_legacy_app_users_from_hot_storage(connection)
    migrated_report_tables = migrate_legacy_report_tables_to_reports(connection)
    migrated_event_joins = migrate_legacy_volunteer_project_joins(connection)
    applied_constraints = apply_data_quality_constraints(connection)
    
    # Apply data retention and archival policies
    retention_cleanup = apply_retention_policies(connection)
    max_limit_cleanup = enforce_max_record_limits(connection)
    
    archival_messages = []
    for table, count in sorted(retention_cleanup.items()):
        archival_messages.append(f"{table}:{count} (expired)")
    for table, count in sorted(max_limit_cleanup.items()):
        archival_messages.append(f"{table}:{count} (over-limit)")
    
    return {
        "dropped_rogue_tables": drop_empty_rogue_tables(connection),
        "cleaned_hot_storage": [f"{key}:{count}" for key, count in sorted(cleaned_collections.items())],
        "pruned_stale_app_users": prune_stale_legacy_app_users(connection),
        "migrated_report_tables": migrated_report_tables,
        "migrated_event_joins": [f"volunteer_event_joins:{migrated_event_joins}"] if migrated_event_joins else [],
        "applied_constraints": applied_constraints,
        "archived_records": archival_messages,
    }
