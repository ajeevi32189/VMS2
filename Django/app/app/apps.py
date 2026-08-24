from django.apps import AppConfig as DjangoAppConfig
import os
import sys
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger


class AppConfig(DjangoAppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "app"

    def ready(self):
        # Avoid running scheduler during migrations or the autoreloader parent process
        if 'migrate' in sys.argv:
            return
        if 'runserver' in sys.argv and os.environ.get('RUN_MAIN') != 'true':
            return

        # Import here to avoid side-effects at import time
        from .tasks import post_all_data

        # Schedule data posting with delays
        try:
            scheduler = BackgroundScheduler()
            
            # Run 5 minutes after startup
            startup_time = datetime.now() + timedelta(minutes=1)
            scheduler.add_job(
                post_all_data,
                DateTrigger(run_date=startup_time),
                id='startup_data_push',
                name='Initial data push (5 min after startup)'
            )
            print(f"Scheduled initial data push for {startup_time.strftime('%Y-%m-%d %H:%M:%S')}")
            
            # Schedule daily at 00:00
            scheduler.add_job(
                post_all_data,
                CronTrigger(hour=0, minute=0),
                id='daily_data_push',
                name='Daily data push at midnight'
            )
            print("Scheduled daily data push for 00:00 (midnight)")
            
            scheduler.start()
        except Exception as e:
            print(f"Failed to start scheduler: {e}")
