# Volunteer System Complete ERD

This XML file contains a comprehensive Entity Relationship Diagram (ERD) for the Volunteer System database that can be imported into draw.io.

## Status: ✅ Ready to Import

The XML file has been validated and is ready for import into draw.io. All parsing errors have been resolved.

## How to Use

1. **Open draw.io**: Go to [draw.io](https://app.diagrams.net/) or [diagrams.net](https://www.diagrams.net/)

2. **Import the ERD**:
   - Click "Open Existing Diagram" or "File" → "Open"
   - Choose "Import from" → "Device" or "URL"
   - Select the `volunteer-system-complete-erd.xml` file

3. **View the Diagram**:
   - The ERD shows all database tables organized by functional modules
   - Relationships between tables are shown with connecting lines
   - Primary Keys (PK) and Foreign Keys (FK) are clearly marked

## Database Tables Included

### Core Tables
- **users**: User accounts (admin, volunteer, partner)
- **partners**: Partner organization profiles
- **volunteers**: Volunteer profiles and information
- **projects**: Main project records (programs and events)
- **programs**: Dedicated program records
- **events**: Event-level records linked to programs

### Supporting Tables
- **dswd_accreditation_numbers**: DSWD accreditation number management
- **messages**: Direct user-to-user messaging
- **project_group_messages**: Project group chat messages
- **reports**: All reporting functionality (partner reports, impact reports, etc.)
- **status_updates**: Project status change history
- **volunteer_matches**: Volunteer-to-project matching workflow
- **volunteer_time_logs**: Volunteer attendance and time tracking
- **volunteer_event_joins**: Volunteer participation records
- **partner_project_applications**: Partner project participation requests
- **admin_planning_calendars**: Admin planning calendar definitions
- **admin_planning_items**: Scheduled planning items

### Example Analytics Table (Not Implemented)
- **analytics**: Example table showing how analytics/metrics could be stored
  - Includes metric types, dimensions, and relationships to core entities
  - Marked with dashed border to indicate it's not currently implemented

## Key Relationships

- **Users** can be associated with partners (as owners) or volunteers
- **Partners** create and manage projects/programs/events
- **Volunteers** participate in projects through matches, joins, and time logs
- **Projects** have status updates, reports, and communication threads
- **Messages** connect users for direct communication
- **Planning** system links to projects for scheduling

## Legend

- **PK**: Primary Key
- **FK**: Foreign Key
- **(jsonb)**: JSON data type for flexible structured data
- **Solid lines**: Required relationships
- **Dashed lines**: Optional relationships
- **Dashed borders**: Tables not yet implemented (like analytics)

## Based On

This ERD is based on:
- `backend/relational_mirror.py` - Canonical table definitions
- `docs/database-tables.md` - Table purposes and relationships
- Current system implementation as of April 29, 2026

## Notes

- All table structures reflect the actual PostgreSQL schema
- JSONB columns are used extensively for flexible data storage
- The analytics table is included as an example of future functionality
- Relationships show the actual foreign key constraints in the database