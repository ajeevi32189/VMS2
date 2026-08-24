from rest_framework.routers import DefaultRouter
from .views import *
from django.urls import path


router = DefaultRouter()

router.register(r'ANPRStatus', AnprstatusViewSet, basename='anprstatus')
router.register(r'CameraAlertStatus', CameraalertstatussViewSet, basename='cameraalertstatuss') 
router.register(r'CameraAlert', CameraalertsViewSet, basename='cameraalerts')
router.register(r'CameraIPList', CameraiplistsViewSet, basename='cameraiplists')
router.register(r'Camera', CamerasViewSet, basename='cameras')
router.register(r'camera_status', CameraStatusViewSet, basename='camera_status')
router.register(r'Group', GroupsViewSet, basename='groups')
router.register(r'Location', LocationViewSet, basename='location')
router.register(r'LocationAnalytics', LocationSummaryViewSet, basename='location-analytics')
router.register(r'Zone', ZoneViewSet, basename='zone')
router.register(r'NVR', NvrViewSet, basename='nvr')
router.register(r'NumberPlateDetection', NumberplatedetectionsViewSet, basename='numberplatedetections')
router.register(r'NumberPlateReadedData', ReadedvehiclenoplatesViewSet, basename='readedvehiclenoplates')
router.register(r'Role', RolesViewSet, basename='roles')
router.register(r'user', UsersViewSet, basename='users')
router.register(r'VehicleDetection', VehicledetectionsViewSet, basename='vehicledetections')
router.register(r'VideoAnalytic', VideoanalyticsViewSet, basename='videoanalytics')
router.register(r'CameraalertsCount', CameraalertsCountViewSet, basename='Cameraalertscount')
router.register(r'event', EventViewSet, basename='event')
router.register(r'Godown', GodownViewSet, basename='godown')
router.register(r'Column', ColumnViewSet, basename='column')
router.register(r'CameraGodownMapping', CameragodownmappingViewSet, basename='cameragodownmapping')
router.register(r'AlertDetails', AlertDetailsViewSet, basename='alert-details')
#router.register(r'MlModels', MlModelsViewSet, basename='mlmodels')
router.register(r'DetectionGroups', DetectionGroupsViewSet, basename='detection_groups')
router.register(r'CameraDetectionMapping', CameraDetectionMappingViewSet, basename='camera_detection_mapping')


urlpatterns = router.urls +[
  path('Auth/login', LoginView.as_view(), name='auth-login'),
]