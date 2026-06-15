# unicred-backend
# 🎓 Student Portal — Prisma Schema

A multi-tenant student portal database schema built with Prisma ORM. Supports **MySQL** (current) and can be switched to **PostgreSQL** by changing a single environment variable.

---

## 📁 Project Structure

```
your-project/
├── prisma/
│   └── schema.prisma       # Prisma schema (paste models here)
├── src/
├── .env                    # Environment variables
└── package.json
```

---

## ⚙️ Setup

### 1. Install dependencies

```bash
npm install prisma @prisma/client
npx prisma init
```

### 2. Configure `.env`

```env
# MySQL (current)
DATABASE_PROVIDER="mysql"
DATABASE_URL="mysql://root:yourpassword@localhost:3306/student_portal"

# PostgreSQL (future) — only change these 2 lines
# DATABASE_PROVIDER="postgresql"
# DATABASE_URL="postgresql://user:password@localhost:5432/student_portal"
```

### 3. Paste the schema

Replace the contents of `prisma/schema.prisma` with the provided schema, keeping your `datasource` block:

```prisma
datasource db {
  provider = env("DATABASE_PROVIDER")
  url      = env("DATABASE_URL")
}
```

### 4. Run migrations

```bash
npx prisma migrate dev --name init
```

### 5. Generate Prisma client

```bash
npx prisma generate
```

---

## 🗄️ Database Schema

### Entities Overview

| Model | Description |
|---|---|
| `School` | Top-level tenant — every record belongs to a school |
| `User` | Auth identity; can be a Student or Faculty |
| `Department` | Belongs to a School; has an optional HOD |
| `Student` | Extended profile linked to a User |
| `Faculty` | Extended profile linked to a User |
| `Semester` | Academic semester scoped to a School |
| `CgpaRecord` | Student CGPA per semester |
| `SubjectMark` | Subject-wise marks per semester |
| `Skill` | Skills listed by a Student |
| `Project` | Projects with optional GitHub link |
| `Achievement` | Uploaded by Student, verified by Faculty |
| `Internship` | Linked optionally to an Achievement |
| `ResumeTemplate` | Template designs available for resumes |
| `Resume` | Resume built by a Student from a template |
| `Notification` | System notifications sent to Users |
| `Announcement` | Posted by Faculty to a Department |

### Enums

| Enum | Values |
|---|---|
| `Role` | `student`, `faculty`, `hod`, `admin` |
| `AchievementStatus` | `pending`, `approved`, `rejected` |
| `ResumeStatus` | `draft`, `published` |

---

## 🔗 Key Relationships

```
School
  ├── Users (has many)
  ├── Departments (has many)
  └── Semesters (has many)

User
  ├── Student (is one, optional)
  └── Faculty (is one, optional)

Student
  ├── CgpaRecords (has many)
  ├── SubjectMarks (has many)
  ├── Skills (has many)
  ├── Projects (has many)
  ├── Achievements (has many)
  ├── Internships (has many)
  └── Resumes (has many)

Achievement
  ├── Verified by Faculty (optional)
  └── Linked to Internship (optional, one-to-one)
```

---

## 💡 Usage Examples

### Create a school

```js
const school = await prisma.school.create({
  data: { name: "MIT", domain: "mit.edu" }
})
```

### Get a student with full profile

```js
const student = await prisma.student.findUnique({
  where: { id: 1 },
  include: {
    user: true,
    department: true,
    cgpaRecords: { include: { semester: true } },
    skills: true,
    projects: true,
    achievements: true,
    internships: true,
  }
})
```

### Get all students in a department

```js
const students = await prisma.student.findMany({
  where: { departmentId: 1 },
  include: { user: true }
})
```

### Faculty verifies an achievement

```js
const achievement = await prisma.achievement.update({
  where: { id: 1 },
  data: {
    status: "approved",
    verifiedBy: facultyId
  }
})
```

### Get CGPA records for a student

```js
const cgpa = await prisma.cgpaRecord.findMany({
  where: { studentId: 1 },
  include: { semester: true },
  orderBy: { semester: { semesterNumber: "asc" } }
})
```

---

## 🔄 Switching to PostgreSQL

1. Update `.env`:
```env
DATABASE_PROVIDER="postgresql"
DATABASE_URL="postgresql://user:password@localhost:5432/student_portal"
```

2. Run migration:
```bash
npx prisma migrate dev --name switch-to-postgres
```

No changes to `schema.prisma` needed. ✅

---

## 🛠️ Useful Commands

| Command | Description |
|---|---|
| `npx prisma migrate dev` | Apply schema changes to DB |
| `npx prisma generate` | Regenerate Prisma client |
| `npx prisma studio` | Visual database browser |
| `npx prisma db pull` | Pull existing DB into schema |
| `npx prisma migrate reset` | Wipe & re-run all migrations (dev only) |
| `npx prisma validate` | Validate your schema file |

---

## 📦 Requirements

- Node.js 16+
- MySQL 5.7+ or PostgreSQL 9.2+
- Prisma 5+
