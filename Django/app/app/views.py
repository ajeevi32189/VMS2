import os
import requests
from requests.exceptions import ConnectTimeout, HTTPError
from rest_framework import status, viewsets, filters
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action
from django.db.models.functions import TruncDate
from django.db.models import Count, Q
from django.utils import timezone
from datetime import timedelta
from django.conf import settings



from django.contrib.auth.hashers import make_password, check_password

from django_filters import rest_framework as django_filters
from django_filters.rest_framework import DjangoFilterBackend

from .models import *
from .serializers import *
from .permissions import *


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 10 
    page_size_query_param = 'pageSize'
    max_page_size = 1000  
    

class AnprstatusViewSet(viewsets.ModelViewSet):
    serializer_class = AnprstatusSerializer
    pagination_class = StandardResultsSetPagination
    
    
    def get_queryset(self):
        user_id = self.request.query_params.get('user_id', None)
        if user_id:
            return Anprstatus.objects.filter(userid=user_id)
        return Anprstatus.objects.all()

class CameraalertstatussViewSet(viewsets.ModelViewSet):
    serializer_class = CameraalertstatussSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        user_id = self.request.query_params.get('user_id', None)
        
        if user_id:
            return Cameraalertstatuss.objects.filter(userid=user_id)
        return Cameraalertstatuss.objects.all()

class CameraalertsFilter(django_filters.FilterSet):
    camera_name = django_filters.filters.CharFilter(field_name='cameraId__name', lookup_expr='icontains')
    camera_location = django_filters.filters.CharFilter(field_name='cameraId__location', lookup_expr='icontains')
    camera_area = django_filters.filters.CharFilter(field_name='cameraId__area', lookup_expr='icontains')
    camera_id = django_filters.filters.NumberFilter(field_name='cameraId', lookup_expr='exact')
    user_id = django_filters.filters.NumberFilter(field_name='userid', lookup_expr='exact')
    
    class Meta:
        model = Cameraalerts
        fields = ['camera_name', 'camera_location', 'camera_area', 'camera_id']
        
class CameraalertsViewSet(viewsets.ModelViewSet):
    serializer_class = CameraalertsSerializer
    pagination_class = StandardResultsSetPagination
    search_fields = ['objectName', 'objectCount', 'alertStatus', 'regDate', 'cameraId__name', 'cameraId__location', 'cameraId__area']
    filter_backends = (filters.SearchFilter, DjangoFilterBackend,)
    filterset_class = CameraalertsFilter

    def get_queryset(self):
        queryset = Cameraalerts.objects.all()
        return queryset
    
class CameraiplistsViewSet(viewsets.ModelViewSet):
    serializer_class = CameraiplistsSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        cameraIP = self.request.query_params.get('cameraIP', None)
        if cameraIP:
            return Cameraiplists.objects.filter(cameraIP=cameraIP)
        return Cameraiplists.objects.all()

class CamerasViewSet(viewsets.ModelViewSet):
    serializer_class = CamerasSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = [
        IsAuthenticated,
        require_claims({
            "SAFE_METHODS": "camera.read",   # GET, HEAD, OPTIONS
            "UNSAFE_METHODS": "camera.write" # POST, PUT, PATCH, DELETE
        })
    ]

    def get_queryset(self):
        user_id = self.request.query_params.get('user_id')
        zone_id = self.request.query_params.get('zone')
        location_id = self.request.query_params.get('location')

        queryset = Cameras.objects.all()

        if user_id:
            queryset = queryset.filter(userid=user_id)
        if zone_id:
            queryset = queryset.filter(zone=zone_id)
        if location_id:
            queryset = queryset.filter(location=location_id)

        return queryset

    def live_stream(self, id, public_url, credit_id):
        """Start live stream by sending a POST request to STREAM_URL service."""
        credit_id = 0 if credit_id is None else credit_id
        stream_url = settings.STREAM_URL 
        try:
            payload = {
                "cameraId": id,
                "rtspUrl": public_url,
                "creditId": credit_id
            }
            response = requests.post(stream_url, json=payload, timeout=10)
            response.raise_for_status()
            print("Stream started successfully.")
        except ConnectTimeout:
            print("Check your internet connection or server status.")
        except HTTPError as http_err:
            print(f"HTTP Error occurred: {http_err}")
        except Exception as e:
            print(f"An unexpected error occurred: {e}")

    def perform_create(self, serializer):
        """Called when a new camera is created."""
        # ✅ Limit total camera entries to 20
        if Cameras.objects.count() >= 100:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"error": "Maximum of 100 camera entries allowed."})

        # Save the camera
        camera = serializer.save()

        # Automatically start live stream if details available
        public_url = camera.rtspurl
        credit_id = self.request.data.get("creditId", None)
        if public_url and credit_id:
            self.live_stream(camera.id, public_url, credit_id)


class CameraStatusViewSet(viewsets.ReadOnlyModelViewSet):
    """API endpoint for camera status without JWT authentication."""
    serializer_class = CameraStatusSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = []  # No authentication required

    def get_queryset(self):
        zone_id = self.request.query_params.get('zone')
        location_id = self.request.query_params.get('location')

        queryset = Cameras.objects.all()

        if zone_id:
            queryset = queryset.filter(zone=zone_id)
        if location_id:
            queryset = queryset.filter(location=location_id)

        return queryset


class LocationViewSet(viewsets.ModelViewSet):
    serializer_class = LocationSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        user_id = self.request.query_params.get('user_id', None)
        if user_id:
            return Location.objects.filter(userid=user_id)
        return Location.objects.all()


class LocationSummaryViewSet(viewsets.ReadOnlyModelViewSet):
    """Return location summaries with counts for cameras and alert types."""
    serializer_class = LocationSummarySerializer

    def get_queryset(self):
        return []

    def list(self, request, *args, **kwargs):
        user_id = request.query_params.get('user_id', None)
        locations = Location.objects.all()
        if user_id:
            locations = locations.filter(userid=user_id)

        results = []


        since = timezone.now() - timedelta(days=1)

        for loc in locations:
            camera_count = Cameras.objects.filter(location=loc.id).count()

            # Count alerts in the last 24 hours linked to cameras at this location
            fire_count = Cameraalerts.objects.filter(
                cameraId__location=loc.id,
                objectName__icontains='fire',
                regDate__gte=since,
            ).count()

            smoke_count = Cameraalerts.objects.filter(
                cameraId__location=loc.id,
                objectName__icontains='smoke',
                regDate__gte=since,
            ).count()

            rodant_count = Cameraalerts.objects.filter(
                cameraId__location=loc.id,
                regDate__gte=since,
            ).filter(Q(objectName__icontains='rodant') | Q(objectName__icontains='rodent')).count()

            results.append({
                "locationName": loc.name,
                "state": loc.state,
                "city": loc.city,
                "pinCode": loc.pincode,
                "cameraCount": camera_count,
                "fireCount": fire_count,
                "smokeCount": smoke_count,
                "rodantCount": rodant_count,
            })

        serializer = LocationSummarySerializer(results, many=True)
        return Response(serializer.data)

class ZoneViewSet(viewsets.ModelViewSet):
    serializer_class = ZoneSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        user_id = self.request.query_params.get('user_id', None)
        if user_id:
            return Zone.objects.filter(userid=user_id)
        return Zone.objects.all()
    
class EventViewSet(viewsets.ModelViewSet):
    serializer_class = EventSerializer
    pagination_class = StandardResultsSetPagination  # optional

    def get_queryset(self):
        user_id = self.request.query_params.get('user_id', None)
        if user_id:
            return Event.objects.filter(userid=user_id)
        return Event.objects.all()

class GroupsViewSet(viewsets.ModelViewSet):
    serializer_class = GroupsSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        user_id = self.request.query_params.get('user_id', None)
        if user_id:
            return Groups.objects.filter(userid=user_id)
        return Groups.objects.all()

class NvrViewSet(viewsets.ModelViewSet):
    serializer_class = NvrSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        user_id = self.request.query_params.get('user_id', None)
        if user_id:
            return Nvr.objects.filter(userid=user_id)
        return Nvr.objects.all()

class NumberplatedetectionsViewSet(viewsets.ModelViewSet):
    serializer_class = NumberplatedetectionsSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        user_id = self.request.query_params.get('user_id', None)
        if user_id:
            return Numberplatedetections.objects.filter(userid=user_id)
        return Numberplatedetections.objects.all()
    

class ReadedvehiclenoplatesFilter(django_filters.FilterSet):
    camera_name = django_filters.filters.CharFilter(field_name='cameraId__name', lookup_expr='icontains')
    camera_location = django_filters.filters.CharFilter(field_name='cameraId__location', lookup_expr='icontains')
    camera_area = django_filters.filters.CharFilter(field_name='cameraId__area', lookup_expr='icontains')
    camera_id = django_filters.filters.NumberFilter(field_name='cameraId', lookup_expr='exact')
    user_id = django_filters.filters.NumberFilter(field_name='userid', lookup_expr='exact')
    vehicle_number = django_filters.filters.CharFilter(field_name='text', lookup_expr='icontains')
    
    class Meta:
        model = Readedvehiclenoplates
        fields = ['camera_name', 'camera_location', 'camera_area', 'camera_id', 'vehicle_number']

    
class ReadedvehiclenoplatesViewSet(viewsets.ModelViewSet):
    serializer_class = ReadedvehiclenoplatesSerializer
    pagination_class = StandardResultsSetPagination 
    search_fields = ['regDate', 'cameraId__name', 'cameraId__location', 'cameraId__area', 'text']
    filter_backends = (filters.SearchFilter, DjangoFilterBackend, )
    filterset_class = ReadedvehiclenoplatesFilter 
    
    def get_queryset(self):
        queryset = Readedvehiclenoplates.objects.all()
        return queryset

class RolesViewSet(viewsets.ModelViewSet):
    serializer_class = RolesSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        user_id = self.request.query_params.get('user_id', None)
        if user_id:
            return Roles.objects.filter(userid=user_id)
        return Roles.objects.all()

class UsersViewSet(viewsets.ModelViewSet):
    serializer_class = UsersSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        # Get the user ID from the request (if passed as a query param)
        user_id = self.request.query_params.get('user_id', None)
        if user_id:
            return Users.objects.filter(id=user_id)
        return Users.objects.all()

    def perform_create(self, serializer):
        # Get the validated data from the serializer
        validated_data = serializer.validated_data

        # Hash the password before saving the user
        password = validated_data.pop('password', None)
        if password:
            validated_data['password'] = make_password(password)

        # Save the user with hashed password
        serializer.save(**validated_data)


class VehicledetectionsViewSet(viewsets.ModelViewSet):
    serializer_class = VehicledetectionsSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        user_id = self.request.query_params.get('user_id', None)
        if user_id:
            return Vehicledetections.objects.filter(userid=user_id)
        return Vehicledetections.objects.all()

class VideoanalyticsViewSet(viewsets.ModelViewSet):
    serializer_class = VideoanalyticsSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        user_id = self.request.query_params.get('user_id', None)
        if user_id:
            return Videoanalytics.objects.filter(userid=user_id)
        return Videoanalytics.objects.all()

class CameraalertsCountViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = CameraalertsSerializer
    pagination_class = StandardResultsSetPagination
    queryset = Cameraalerts.objects.all()

    def list(self, request, *args, **kwargs):
        user_id = request.query_params.get('user_id')
        from_date = request.query_params.get('from_date')
        to_date = request.query_params.get('to_date')

        queryset = self.get_queryset()

        # Filter by user ID (optional)
        if user_id:
            queryset = queryset.filter(userid=user_id)

        # Date range filters with last 24 hours as default
        if from_date and to_date:
            queryset = queryset.filter(regDate__date__range=[from_date, to_date])
        elif from_date:
            queryset = queryset.filter(regDate__date__gte=from_date)
        elif to_date:
            queryset = queryset.filter(regDate__date__lte=to_date)
        else:
            # Default: include data from last 24 hours
            current_time = timezone.now()
            since = current_time - timedelta(hours=24)
            queryset = queryset.filter(regDate__gte=since, regDate__lte=current_time)

        # Group and count per day
        daily_counts = (
            queryset
            .annotate(date=TruncDate('regDate'))
            .values('date')
            .annotate(count=Count('id'))
            .order_by('date')
        )

        return Response(daily_counts)

class GodownViewSet(viewsets.ModelViewSet):
    serializer_class = GodownSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        return Godown.objects.all()

class ColumnViewSet(viewsets.ModelViewSet):
    serializer_class = ColumnSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        return Column.objects.all()

class CameragodownmappingViewSet(viewsets.ModelViewSet):
    serializer_class = CameragodownmappingSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        return Cameragodownmapping.objects.all()


class AlertDetailsViewSet(viewsets.ReadOnlyModelViewSet):
    """Return detailed alert information with camera, location, godown, and column info."""
    serializer_class = AlertDetailsSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return []

    def list(self, request, *args, **kwargs):
        user_id = request.query_params.get('user_id', None)
        camera_id = request.query_params.get('camera_id', None)
        from_date = request.query_params.get('from_date', None)
        to_date = request.query_params.get('to_date', None)

        # Start with alerts from last 24 hours by default with proper timezone handling
        current_time = timezone.now()
        since = current_time - timedelta(hours=24)
        
        # Optimize queries: use select_related for foreign keys
        alerts = Cameraalerts.objects.filter(regDate__gte=since, regDate__lte=current_time).select_related('cameraId').order_by('-regDate')

        # Filter by user if provided
        if user_id:
            alerts = alerts.filter(userid=user_id)

        # Filter by camera if provided
        if camera_id:
            alerts = alerts.filter(cameraId=camera_id)

        # Date range filters override default 24-hour filter
        if from_date and to_date:
            alerts = alerts.filter(regDate__date__range=[from_date, to_date])
        elif from_date:
            alerts = alerts.filter(regDate__date__gte=from_date)
        elif to_date:
            alerts = alerts.filter(regDate__date__lte=to_date)

        # Fetch all locations and mappings at once instead of one by one
        location_ids = set()
        camera_ids = set()
        
        for alert in alerts:
            if alert.cameraId:
                camera_ids.add(alert.cameraId.id)
                if alert.cameraId.location:
                    location_ids.add(alert.cameraId.location)
        
        # Bulk load locations and mappings
        locations_map = {}
        if location_ids:
            locations = Location.objects.filter(id__in=location_ids).values('id', 'name', 'state', 'city', 'pincode')
            locations_map = {loc['id']: loc for loc in locations}
        
        mappings_map = {}
        if camera_ids:
            mappings = Cameragodownmapping.objects.filter(cameraId__in=camera_ids).select_related('godownId', 'columnId').values(
                'cameraId', 'godownId__name', 'columnId__name'
            )
            mappings_map = {m['cameraId']: m for m in mappings}

        results = []

        for alert in alerts:
            camera = alert.cameraId
            if not camera:
                continue

            # Get location info from pre-fetched map
            location = locations_map.get(camera.location) if camera.location else None

            # Get godown and column mapping from pre-fetched map
            mapping = mappings_map.get(camera.id)

            results.append({
                "cameraIP": camera.cameraIP or "",
                "cameraName": camera.name or "",
                "locationName": location['name'] if location else "",
                "shadName": mapping['godownId__name'] if mapping else "",
                "columnName": mapping['columnId__name'] if mapping else "",
                "state": location['state'] if location else "",
                "pinCode": location['pincode'] if location else "",
                "city": location['city'] if location else "",
                "cameraId": camera.id,
                "imagePath": alert.framePath or "",
                "alertType": alert.objectName or "",
                "alertDateTime": alert.regDate,
            })

        serializer = AlertDetailsSerializer(results, many=True)
        return Response(serializer.data)


# class MlModelsViewSet(viewsets.ModelViewSet):
#     serializer_class = MlModelsSerializer
#     pagination_class = StandardResultsSetPagination
    
#     def get_queryset(self):
#         user_id = self.request.query_params.get('user_id', None)
#         camera_id = self.request.query_params.get('camera_id', None)
        
#         queryset = MlModels.objects.all()
        
#         if user_id:
#             queryset = queryset.filter(userid=user_id)
#         if camera_id:
#             queryset = queryset.filter(cameraId=camera_id)
            
#         return queryset


class LoginView(APIView):
    
    def post(self, request):
        # Deserialize the input data
        serializer = LoginSerializer(data=request.data)
        
        if serializer.is_valid():
            username = serializer.validated_data['username']
            password = serializer.validated_data['password']
            
            try:
                # Try to find the user by the username
                user = Users.objects.get(username=username)
                
                # Check if the provided password matches the stored password hash
                if check_password(password, user.password):
                    # Password is correct, return success
                    return Response({
                        'message': 'Login successful',
                        'user_id': user.id,
                        'username': user.username,
                        'firstName': user.firstName,
                        'lastName': user.lastName,
                        'emailId': user.emailId,
                    }, status=status.HTTP_200_OK)
                
                else:
                    # Invalid password
                    return Response({'error': 'Invalid password'}, status=status.HTTP_400_BAD_REQUEST)
            
            except Users.DoesNotExist:
                # User not found
                return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class DetectionGroupsViewSet(viewsets.ModelViewSet):
    serializer_class = DetectionGroupsSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        return DetectionGroups.objects.all()

class CameraDetectionMappingViewSet(viewsets.ModelViewSet):
    serializer_class = CameraDetectionMappingSerializer
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        camera_id = self.request.query_params.get('camera_id', None)
        # default to returning only active records
        is_active = self.request.query_params.get('is_active', '1')
        
        queryset = CameraDetectionMapping.objects.all()
        
        if is_active == '1':
            queryset = queryset.filter(is_active=True)
        elif is_active == '0':
            queryset = queryset.filter(is_active=False)
            
        if camera_id:
            queryset = queryset.filter(cameraId=camera_id)
            
        return queryset

    def create(self, request, *args, **kwargs):
        # We override create to handle the active toggling logic
        camera_id = request.data.get('cameraId')
        
        if not camera_id:
            return Response({'error': 'cameraId is required'}, status=status.HTTP_400_BAD_REQUEST)
            
        # Deactivate previous records for this camera
        CameraDetectionMapping.objects.filter(cameraId=camera_id, is_active=True).update(is_active=False)
        
        # We ensure is_active is True for the new record
        # In a typical setup with DRF ModelViewSet, we just let serializer handle it
        # Since is_active defaults to True in the model, we can just pass the data
        # But we force it to true just in case the user passed is_active=False
        data = request.data.copy()
        data['is_active'] = True
        
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)
