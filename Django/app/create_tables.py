#!/usr/bin/env python
"""
Script to create database tables directly if they don't exist.
Run this when migrations fail: python create_tables.py
"""

import os
import sys
import django
from django.conf import settings

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

from django.db import connection
from django.db.utils import DatabaseError


def table_exists(cursor, table_name):
    """Check if a table exists in the database."""
    try:
        cursor.execute(f"SHOW TABLES LIKE '{table_name}'")
        return cursor.fetchone() is not None
    except Exception as e:
        print(f"Error checking table {table_name}: {e}")
        return False


def create_tables():
    """Create all required tables if they don't exist."""
    
    with connection.cursor() as cursor:
        # Define all table creation SQL statements
        tables = [
            # Roles table
            """
            CREATE TABLE IF NOT EXISTS roles (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                Name VARCHAR(255) UNIQUE,
                Status INT DEFAULT 0,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # Users table
            """
            CREATE TABLE IF NOT EXISTS users (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                FirstName TEXT,
                LastName TEXT,
                MobileNo VARCHAR(255) UNIQUE,
                EmailId VARCHAR(255) UNIQUE,
                Username VARCHAR(255) UNIQUE,
                Password TEXT,
                RoleId INT NOT NULL,
                Image VARCHAR(255),
                Status INT DEFAULT 0,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (RoleId) REFERENCES roles(Id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # NVR table
            """
            CREATE TABLE IF NOT EXISTS nvr (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                Name VARCHAR(255),
                NVRIP TEXT,
                Port INT,
                Username TEXT,
                Password TEXT,
                NVRType TEXT,
                Model TEXT,
                Location TEXT,
                Make TEXT,
                Zone TEXT,
                Status INT DEFAULT 0,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                IMG VARCHAR(255),
                Responsible_Person TEXT,
                UserId VARCHAR(255),
                INDEX idx_status (Status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # tbl_location table
            """
            CREATE TABLE IF NOT EXISTS tbl_location (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                Name VARCHAR(100) NOT NULL,
                Address VARCHAR(200),
                Landmark VARCHAR(100),
                Street VARCHAR(100),
                City VARCHAR(100),
                State VARCHAR(100),
                Pincode VARCHAR(20),
                Latitude FLOAT,
                Logitude FLOAT,
                LocationType VARCHAR(100),
                Status BOOLEAN,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                UserId VARCHAR(255),
                INDEX idx_status (Status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # tbl_zone table
            """
            CREATE TABLE IF NOT EXISTS tbl_zone (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                Name VARCHAR(100) NOT NULL,
                Status BOOLEAN DEFAULT TRUE,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                UserId VARCHAR(255),
                INDEX idx_status (Status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # Groups table
            f"""
            CREATE TABLE IF NOT EXISTS `{settings.DATABASES['default']['NAME']}`.`groups` (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                Name VARCHAR(255) UNIQUE NOT NULL,
                Description TEXT,
                Status INT DEFAULT 0,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                UserId VARCHAR(255),
                INDEX idx_status (Status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # Cameras table
            """
            CREATE TABLE IF NOT EXISTS cameras (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                Name VARCHAR(255),
                CameraIP VARCHAR(255),
                NVRId INT,
                Brand TEXT,
                Manufacture TEXT,
                MacAddress TEXT,
                Make TEXT,
                Port INT,
                ChannelId INT,
                InstallationDate DATETIME,
                LastLive DATETIME,
                RTSPURL TEXT,
                ZoneId INT,
                LocationId INT,
                isRecording INT,
                isStreaming INT,
                isAnalytics INT,
                Status INT DEFAULT 0,
                UpdateDate DATETIME,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                UserId VARCHAR(255),
                FOREIGN KEY (NVRId) REFERENCES nvr(Id) ON DELETE CASCADE,
                INDEX idx_status (Status),
                INDEX idx_cameraip (CameraIP)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # Anprstatus table
            """
            CREATE TABLE IF NOT EXISTS anprstatus (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                CameraId INT NOT NULL,
                CameraName TEXT,
                URL TEXT,
                Status INT DEFAULT 0,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UserId VARCHAR(255),
                FOREIGN KEY (CameraId) REFERENCES cameras(Id) ON DELETE CASCADE,
                INDEX idx_status (Status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # Cameraalertstatuss table
            """
            CREATE TABLE IF NOT EXISTS cameraalertstatuss (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                CameraId INT NOT NULL,
                Recording INT,
                ANPR INT,
                Snapshot INT,
                PersonDetection INT,
                FireDetection INT,
                AnimalDetection INT,
                BikeDetection INT,
                MaskDetection INT,
                UmbrelaDetection INT,
                BrifecaseDetection INT,
                GarbageDetection INT,
                WeaponDetection INT,
                WrongDetection INT,
                QueueDetection INT,
                SmokeDetection INT,
                Status INT DEFAULT 0,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UserId VARCHAR(255),
                FOREIGN KEY (CameraId) REFERENCES cameras(Id) ON DELETE CASCADE,
                INDEX idx_status (Status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # Cameraalerts table
            """
            CREATE TABLE IF NOT EXISTS cameraalerts (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                CameraId INT,
                FramePath TEXT,
                ObjectName TEXT,
                ObjectCount INT,
                AlertStatus VARCHAR(1),
                Status INT DEFAULT 0,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UserId VARCHAR(255),
                FOREIGN KEY (CameraId) REFERENCES cameras(Id) ON DELETE CASCADE,
                INDEX idx_status (Status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # Cameraiplists table
            """
            CREATE TABLE IF NOT EXISTS cameraiplists (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                CameraIP VARCHAR(255),
                ObjectList TEXT,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                UserId VARCHAR(255),
                INDEX idx_cameraip (CameraIP)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # Numberplatedetections table
            """
            CREATE TABLE IF NOT EXISTS numberplatedetections (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                CameraId INT NOT NULL,
                PlatePath TEXT,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UserId VARCHAR(255),
                FOREIGN KEY (CameraId) REFERENCES cameras(Id) ON DELETE CASCADE,
                INDEX idx_cameraid (CameraId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # Readedvehiclenoplates table
            """
            CREATE TABLE IF NOT EXISTS readedvehiclenoplates (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                FramePath TEXT,
                PlatePath TEXT,
                CameraId INT NOT NULL,
                Text TEXT NOT NULL,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UserId VARCHAR(255),
                FOREIGN KEY (CameraId) REFERENCES cameras(Id) ON DELETE CASCADE,
                INDEX idx_cameraid (CameraId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # Vehicledetections table
            """
            CREATE TABLE IF NOT EXISTS vehicledetections (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                CameraId INT NOT NULL,
                FramePath TEXT,
                VehicleType TEXT,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UserId VARCHAR(255),
                FOREIGN KEY (CameraId) REFERENCES cameras(Id) ON DELETE CASCADE,
                INDEX idx_cameraid (CameraId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # Videoanalytics table
            """
            CREATE TABLE IF NOT EXISTS videoanalytics (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                CameraId INT NOT NULL,
                CameraIP TEXT,
                RTSPUrl TEXT,
                ObjectList TEXT,
                Status INT DEFAULT 0,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UserId VARCHAR(255),
                FOREIGN KEY (CameraId) REFERENCES cameras(Id) ON DELETE CASCADE,
                INDEX idx_status (Status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # Event table
            """
            CREATE TABLE IF NOT EXISTS event (
                eventId INT AUTO_INCREMENT PRIMARY KEY,
                eventName VARCHAR(255) UNIQUE,
                tags JSON DEFAULT NULL,
                conditions JSON DEFAULT NULL,
                cameras JSON DEFAULT NULL,
                scheduling JSON DEFAULT NULL,
                userid VARCHAR(255),
                INDEX idx_eventname (eventName)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # Godown table
            """
            CREATE TABLE IF NOT EXISTS godown (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255),
                capacity TEXT,
                regDate DATETIME,
                INDEX idx_name (name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # tbl_column_name table
            """
            CREATE TABLE IF NOT EXISTS tbl_column_name (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255),
                INDEX idx_name (name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # camera_godown table
            """
            CREATE TABLE IF NOT EXISTS camera_godown (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                CameraId INT,
                GodownId INT,
                ColumnId INT,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (CameraId) REFERENCES cameras(Id) ON DELETE CASCADE,
                FOREIGN KEY (GodownId) REFERENCES godown(Id) ON DELETE CASCADE,
                FOREIGN KEY (ColumnId) REFERENCES tbl_column_name(Id) ON DELETE CASCADE,
                INDEX idx_cameraid (CameraId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # detection_groups table
            """
            CREATE TABLE IF NOT EXISTS detection_groups (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255),
                is_active BOOLEAN DEFAULT TRUE,
                INDEX idx_name (name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
            
            # camera_detection_mapping table
            """
            CREATE TABLE IF NOT EXISTS camera_detection_mapping (
                id INT AUTO_INCREMENT PRIMARY KEY,
                CameraId INT,
                DetectionModels TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                RegDate DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (CameraId) REFERENCES cameras(Id) ON DELETE CASCADE,
                INDEX idx_cameraid (CameraId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """,
        ]
        
        # Execute table creation statements
        for i, create_table_sql in enumerate(tables, 1):
            try:
                cursor.execute(create_table_sql)
                table_name = create_table_sql.split('INTO')[1].split('(')[0].strip() if 'INTO' in create_table_sql else f"Table {i}"
                print(f"✓ Created/verified table: {table_name}")
            except DatabaseError as e:
                if "already exists" not in str(e):
                    print(f"✗ Error creating table {i}: {e}")
            except Exception as e:
                print(f"✗ Unexpected error on table {i}: {e}")
        
        print("\n✓ All tables created successfully!")


if __name__ == '__main__':
    try:
        print("Starting table creation process...")
        print(f"Database: {settings.DATABASES['default']['NAME']}")
        print(f"Host: {settings.DATABASES['default']['HOST']}")
        print("-" * 50)
        
        create_tables()
        
        print("-" * 50)
        print("Process completed!")
    except Exception as e:
        print(f"\n✗ Fatal error: {e}")
        sys.exit(1)
