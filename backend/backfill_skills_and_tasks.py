#!/usr/bin/env python3
"""
Backfill script to populate skills and tasks tables with existing data from projects and events.
Run this after updating the relational_mirror schema.
"""
import json
import os
from datetime import datetime, timezone
from typing import Any

from db import get_connection
from relational_mirror import (
    get_relational_collection,
    upsert_relational_item,
)


def _now_text() -> str:
    return datetime.now(timezone.utc).isoformat()


def backfill_skills_and_tasks() -> None:
    """Backfill skills and tasks tables from existing projects and events."""
    with get_connection() as connection:
        try:
            # Note: We skip ensure_relational_mirror_tables because it has a pre-existing issue with program_tracks
            # The skills and tasks tables are created in the relational_mirror.py DDL already
            print("Initializing backfill process...")

            # Get all projects
            print("Fetching all projects...")
            try:
                projects = get_relational_collection(connection, "projects")
                print(f"Found {len(projects)} projects")
            except Exception as e:
                print(f"Note: Could not fetch projects: {e}")
                projects = []

            # Get all events
            print("Fetching all events...")
            try:
                events = get_relational_collection(connection, "events")
                print(f"Found {len(events)} events")
            except Exception as e:
                print(f"Note: Could not fetch events: {e}")
                events = []

            # Combine projects and events
            all_items = projects + events

            # Extract and upsert all unique skills
            print("\nExtracting skills from projects and events...")
            skills: set[str] = set()
            for item in all_items:
                if not isinstance(item, dict):
                    continue
                # Get skills from project level
                item_skills = item.get("skillsNeeded") or []
                if isinstance(item_skills, list):
                    for skill in item_skills:
                        if isinstance(skill, str) and skill.strip():
                            skills.add(skill.strip())

                # Get skills from internal tasks
                internal_tasks = item.get("internalTasks") or []
                if isinstance(internal_tasks, list):
                    for task in internal_tasks:
                        if isinstance(task, dict):
                            task_skills = task.get("skillsNeeded") or []
                            if isinstance(task_skills, list):
                                for skill in task_skills:
                                    if isinstance(skill, str) and skill.strip():
                                        skills.add(skill.strip())

            # Upsert skills
            print(f"Upserting {len(skills)} unique skills...")
            skills_created = 0
            for skill in sorted(skills):
                if skill:
                    upsert_relational_item(
                        connection,
                        "skills",
                        {
                            "id": skill,
                            "name": skill,
                            "createdAt": _now_text(),
                            "updatedAt": _now_text(),
                        },
                    )
                    skills_created += 1
            connection.commit()
            print(f"Created/updated {skills_created} skills")

            # Extract and upsert all tasks
            print("\nExtracting tasks from projects and events...")
            tasks_created = 0
            for item in all_items:
                if not isinstance(item, dict):
                    continue
                internal_tasks = item.get("internalTasks") or []
                if isinstance(internal_tasks, list):
                    for task in internal_tasks:
                        if isinstance(task, dict) and task.get("id"):
                            upsert_relational_item(
                                connection,
                                "tasks",
                                {
                                    "id": task.get("id"),
                                    "title": task.get("title") or "",
                                    "description": task.get("description"),
                                    "category": task.get("category"),
                                    "priority": task.get("priority"),
                                    "status": task.get("status"),
                                    "assignedVolunteerId": task.get("assignedVolunteerId"),
                                    "assignedVolunteerName": task.get("assignedVolunteerName"),
                                    "isFieldOfficer": task.get("isFieldOfficer", False),
                                    "skillsNeeded": task.get("skillsNeeded", []),
                                    "createdAt": task.get("createdAt") or _now_text(),
                                    "updatedAt": task.get("updatedAt") or _now_text(),
                                },
                            )
                            tasks_created += 1
            connection.commit()
            print(f"Created/updated {tasks_created} tasks")

            print("\n✅ Backfill complete!")
            print(f"   - Skills: {skills_created}")
            print(f"   - Tasks: {tasks_created}")

        except Exception as e:
            print(f"❌ Error during backfill: {e}")
            connection.rollback()
            raise


if __name__ == "__main__":
    backfill_skills_and_tasks()
