# SmartAttend ERP — Real-Time QR + BLE Two-Factor Attendance System

A modern, enterprise-grade attendance solution combining dynamic server-generated QR codes with Bluetooth Low Energy (BLE) proximity verification to eliminate proxy attendance.

---

## 1. System Architecture

```
                    +------------------------------------+
                    |       Faculty Device (Screen)      |
                    |  - Starts lecture session          |
                    |  - Broadcasts BLE beacon (SA-XXXX) |
                    |  - Renders 15s rotating dynamic QR |
                    +-----------------+------------------+
                                      |
                         Dynamic QR   |   BLE Beacon
                         (15s TTL)    |   (Proximity)
                                      v
                    +------------------------------------+
                    |      Student Device (Mobile)       |
                    |  - Authenticated via Supabase      |
                    |  - Camera scans dynamic QR token   |
                    |  - Scans & validates BLE beacon    |
                    +-----------------+------------------+
                                      |
                      POST /api/attendance/verify
                      (Token + BLE RSSI + JWT)
                                      v
+-------------------------------------------------------------------------+
|                       SmartAttend Backend Engine                        |
|                                                                         |
| 1. Authenticate student identity from JWT                              |
| 2. Verify active lecture session (not expired/ended)                    |
| 3. Validate student class enrollment                                    |
| 4. Validate Factor 1: SHA-256 token hash exists & expires_at > now()   |
| 5. Validate Factor 2: BLE identifier matches & RSSI >= threshold        |
| 6. Check unique constraint: (lecture_session_id, student_id)            |
| 7. Insert verified attendance record into PostgreSQL                    |
+------------------------------------+------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                  Supabase PostgreSQL + Realtime Engine                  |
|                                                                         |
|  - Realtime WebSocket broadcast on 'attendance' table INSERT            |
|  - Faculty live attendance counter & roster increment instantly         |
|  - Student attendance history and percentage updated permanently        |
+-------------------------------------------------------------------------+
```

---

## 2. Completed Features

1. **Dynamic Server QR Engine**:
   - Backend-issued short-lived tokens rotating every 15 seconds (`/api/session/token`).
   - Plaintext format: `session_id:timestamp:nonce`.
   - Stored as SHA-256 hashes with hard TTL in `attendance_tokens`.
   - Expired or forged QR codes are automatically rejected.
2. **Camera QR Scanner**:
   - Hardware-accelerated camera scanner using `Html5Qrcode`.
   - Automatic environment facingMode (rear camera) selection.
   - Real-time frame decoding and token extraction.
3. **Bluetooth Low Energy (BLE) Proximity Verification**:
   - `ble-service.js` supports native Android via Capacitor (`@capacitor-community/bluetooth-le`) and Web Bluetooth API for Chromium browsers.
   - Measures RSSI proximity with configurable threshold (-75 dBm default).
   - Clear error messages when hardware or permissions are unavailable.
   - Developer Test Mode toggle for testing in environments without Bluetooth beacons.
4. **Real User Authentication & Authorization**:
   - Supabase Auth integration with test roles (Aarav Sharma for student, Dr. Meera Kulkarni for faculty, Prof. Rohan Deshmukh for admin).
   - JWT validation on all sensitive backend routes.
5. **PostgreSQL Database & Row Level Security (RLS)**:
   - Tables: `classes`, `subjects`, `profiles`, `faculty_subjects`, `lecture_sessions`, `attendance`, `attendance_tokens`.
   - Hard unique constraint on `(lecture_session_id, student_id)` prevents double-marking.
   - RLS policies restrict attendance insertion to authenticated sessions.
6. **Real-Time Synchronization**:
   - Supabase Realtime channel subscription updates the faculty dashboard live upon student check-in without page refresh.

---

## 3. Database Schema Setup (Supabase)

1. Open your [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to the **SQL Editor**.
3. Open `supabase/schema.sql` from this repository.
4. Paste the entire SQL script and click **Run**.
5. Enable **Realtime** for tables `attendance` and `lecture_sessions` (configured in the schema script).

---

## 4. Environment Variables Configuration

In Vercel or your local `.env` file, configure the following variables:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Client-facing aliases
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> **Security Note**: Never expose the `SUPABASE_SERVICE_ROLE_KEY` to frontend code or public repositories. It is strictly used in `/api/` serverless functions.

---

## 5. Deployment Instructions (Vercel)

1. Push your repository to GitHub:
   ```bash
   git push origin main
   ```
2. In Vercel, click **New Project** and import `kunalllk/smartattend-erp`.
3. Add the environment variables from Section 4 under **Project Settings -> Environment Variables**.
4. Click **Deploy**.
5. Vercel automatically deploys the frontend and serverless API functions in `/api/`.

---

## 6. Native Android App Setup (Capacitor)

Because Web Bluetooth in standard browsers does not allow BLE peripheral advertising and has restricted scanning on iOS Safari, an Android build using Capacitor provides native BLE beacon broadcasting and background scanning.

### Setup Steps:
```bash
# 1. Install dependencies
npm install

# 2. Add Android platform
npx cap add android

# 3. Synchronize assets
npx cap sync android

# 4. Open Android Studio
npx cap open android
```

### Android Permissions (`android/app/src/main/AndroidManifest.xml`):
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

---

## 7. Step-by-Step Two-Device Testing Guide

### Prerequisites
- **Device 1 (Faculty Screen)**: Laptop or tablet showing the Faculty dashboard.
- **Device 2 (Student Device)**: Smartphone with camera.

### Execution:
1. **Device 1 (Faculty)**:
   - Open SmartAttend and select **Faculty** (Dr. Meera Kulkarni).
   - Click **Live Lecture** or **Start Lecture** for *Data Structures · Theory*.
   - The screen shows the active lecture, **BLE Beacon ID** (e.g. `SA-8E4A91B2`), and the **Dynamic QR code** with a 15-second countdown bar.
2. **Device 2 (Student)**:
   - Open SmartAttend on your phone and select **Student** (Aarav Sharma).
   - Click the cyan **Scan QR Code** button.
   - Point the camera at Device 1's screen.
3. **Verification**:
   - The scanner captures the QR token.
   - The system checks the classroom BLE proximity signal.
   - The backend validates both cryptographic factors and records attendance in Supabase.
4. **Live Synchronization**:
   - Device 2 displays *"Attendance marked successfully"*.
   - Device 1's live counter automatically increments (e.g., `1/12 Present`) and Aarav Sharma appears marked with green checkmark **without refreshing the page**.
5. **Duplicate Test**:
   - Scan again on Device 2: The server immediately rejects duplicate submission with *"Attendance already recorded for this lecture"*.
6. **Expiry Test**:
   - Try scanning an old photo of the QR code taken > 15 seconds ago: Rejected with *"QR token expired"*.
