from pathlib import Path
import os
from datetime import timedelta


BASE_DIR = Path(__file__).resolve().parent.parent

# Streaming service URL
STREAM_URL = "http://14.195.152.244:9015/Streaming/add_camera"


SECRET_KEY = "django-insecure-jx4u%wv&xx*kqasijum!mmxz8u179s!%mo1m)io#r+_v9tt6_t"

DEBUG = True

ALLOWED_HOSTS = ['*']


# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "app",
    "rest_framework",
    "corsheaders",
    "django_filters",

]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    'corsheaders.middleware.CorsMiddleware',
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "core.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        }, 
    },
]

WSGI_APPLICATION = "core.wsgi.application"


# Database
# https://docs.djangoproject.com/en/5.0/ref/settings/#databases

DATABASES = {
    "default": {
            # 'ENGINE': 'django.db.backends.mysql',  # Or 'postgresql', 'sqlite3', etc.
            # 'NAME': 'new_vms',
            # 'USER': 'vms',
            # 'PASSWORD': 'Ajeevi@#321890',
            # 'HOST': 'sqldb',
            #'HOST': '14.195.152.244',  # Or your DB host
            # 'PORT': '3306',
            #'PORT': '3010',
            'ENGINE': os.getenv('DB_ENGINE', 'django.db.backends.mysql'),
            'NAME': os.getenv('DB_NAME', 'new_vms'),
            'USER': os.getenv('DB_USER', 'vms'),
            'PASSWORD': os.getenv('DB_PASSWORD', 'Ajeevi@#321890'),
            'HOST': os.getenv('DB_HOST', '14.195.152.244'),
            'PORT': os.getenv('DB_PORT', '8021'),
    }
}


# Password validation
# https://docs.djangoproject.com/en/5.0/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

UMMS_JWT = {
    "SECRET": "ThisIsASuperSecretKeyForJwt1234567890!!",
    "ISSUER": "https://localhost:44328",
    "AUDIENCE": "https://localhost:44328",
}

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "app.umms_auth.UMMSJWTAuthentication",
    )
}

# Internationalization
# https://docs.djangoproject.com/en/5.0/topics/i18n/

LANGUAGE_CODE = "en-us"

TIME_ZONE = "Asia/Kolkata"

USE_I18N = True

USE_TZ = True




STATIC_URL = "static/"
MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media/')




DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# REST_FRAMEWORK = {
#     'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',  # Or another pagination class
#     'PAGE_SIZE': 10,  # Number of items per page
# }

# cors headers
CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_HEADERS = (
    "accept",
    "authorization",
    "content-type",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
)


