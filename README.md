#  Sparq AI Chatbot Web

Sparq AI adalah platform chatbot berbasis web yang menggunakan **Flask** sebagai backend dan **Gemini API** sebagai model kecerdasan utama.  
Project ini dirancang untuk menghadirkan percakapan yang fleksibel dan kontekstual, dengan sistem autentikasi pengguna, penyimpanan riwayat chat, dan dukungan akun *guest*.

---

## Preview Website

**Live demo:** [https://madrl.pythonanywhere.com](https://madrl.pythonanywhere.com/)
##  Fitur Utama

---

- 🔹 **Autentikasi Pengguna**
  - Registrasi dan login dengan verifikasi email OTP
  - Dukungan akun *guest* tanpa registrasi

- 🔹 **Chat Interaktif**
  - Terintegrasi dengan **Gemini API (Google AI)** untuk respons dinamis
  - Mendukung percakapan multi-session
  - Penyimpanan riwayat percakapan di database

- 🔹 **Manajemen Database**
  - Menggunakan **MySQL / SQLAlchemy ORM**
  - Relasi antara `User` dan `ChatSession`

- 🔹 **Antarmuka Web**
  - Dibangun dengan **HTML, CSS, dan JavaScript**
  - Mendukung tampilan responsif dan interaktif
  - Logo dan branding dapat dikustomisasi

---

## Struktur Database

### Tabel `user`
| Kolom | Tipe | Keterangan |
|-------|------|------------|
| id | Integer | Primary key |
| username | String(80) | Unik, nama pengguna |
| email | String(120) | Unik, email pengguna |
| password_hash | String(200) | Hash password |
| is_verified | Boolean | Status verifikasi |
| otp_code | String(6) | Kode OTP |
| otp_created_at | DateTime | Waktu OTP dibuat |
| created_at | DateTime | Tanggal pembuatan akun |
| daily_message_count | Integer | Jumlah pesan harian |
| last_message_date | Date | Tanggal terakhir kirim pesan |

### Tabel `chat_session`
| Kolom | Tipe | Keterangan |
|-------|------|------------|
| id | String(50) | Primary key |
| user_id | Integer (FK → user.id) | Relasi ke pengguna |
| title | String(200) | Judul sesi chat |
| messages | Text | Riwayat pesan |
| history | Text | Riwayat kontekstual |
| created_at | DateTime | Waktu sesi dibuat |
| updated_at | DateTime | Waktu sesi diperbarui |

---

##  Teknologi yang Digunakan

- **Backend:** Flask (Python)
- **Frontend:** HTML, CSS, JavaScript
- **Database:** MySQL + SQLAlchemy
- **AI Model:** Gemini API (`gemini-2.0-flash-exp`)
- **Hosting:** PythonAnywhere (Free Plan)

---

##  Cara Menjalankan di Lokal

1. **Clone Repository**
   ```bash
   git clone https://github.com/username/sparq-ai.git
   cd sparq-ai

---
## Lisensi

Proyek ini menggunakan lisensi Attribution License (Custom).
Artinya, siapa pun diperbolehkan untuk menggunakan, memodifikasi, dan mendistribusikan proyek ini selama tetap mencantumkan kredit kepada pembuat asli:
© 2025 madrl
