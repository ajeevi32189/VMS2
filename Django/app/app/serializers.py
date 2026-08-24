from rest_framework import serializers
from .models import *


class AnprstatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = Anprstatus
        fields = '__all__'
        
              
class CameraalertstatussSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cameraalertstatuss
        fields = '__all__'
        
class CameraalertsSerializer(serializers.ModelSerializer):
    camera_name = serializers.CharField(source='cameraId.name', read_only=True)
    camera_location = serializers.SerializerMethodField()
    camera_area = serializers.CharField(source='cameraId.area', read_only=True)
    
    class Meta:
        model = Cameraalerts
        fields = ['id', 'cameraId', 'framePath', 'objectName', 'objectCount', 'alertStatus', 
                  'status', 'regDate', 'userid', 'camera_name', 'camera_location', 'camera_area']
    
    def get_camera_location(self, obj):
        """Fetch location name from Location model using location ID"""
        if obj.cameraId and obj.cameraId.location:
            try:
                location = Location.objects.get(id=obj.cameraId.location)
                return location.name
            except Location.DoesNotExist:
                return None
        return None
        
class CameraiplistsSerializer(serializers.ModelSerializer):
    class Meta:
        
        model = Cameraiplists
        fields = '__all__'
        
class CamerasSerializer(serializers.ModelSerializer):
    location_name = serializers.SerializerMethodField()
    zone_name = serializers.SerializerMethodField()
    zone_id = serializers.IntegerField(source='zone', write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = Cameras
        fields = ['id', 'name', 'cameraIP', 'nvrId', 'brand', 'manufacture', 'macAddress', 
                  'make', 'port', 'channelId', 'installationDate', 'lastLive', 'rtspurl', 
                  'zone_id', 'zone_name', 'location', 'isRecording', 'isStreaming', 'isAnalytics', 'status', 
                  'updateDate', 'regDate', 'userid', 'location_name']
    
    def get_location_name(self, obj):
        """Fetch location name from Location model using location ID"""
        if obj.location:
            try:
                location = Location.objects.get(id=obj.location)
                return location.name
            except Location.DoesNotExist:
                return None
        return None
    
    def get_zone_name(self, obj):
        """Fetch zone name from Zone model using zone ID"""
        if obj.zone:
            try:
                zone = Zone.objects.get(id=obj.zone)
                return zone.name
            except Zone.DoesNotExist:
                return None
        return None

class CameraStatusSerializer(serializers.ModelSerializer):
    location_name = serializers.SerializerMethodField()
    
    class Meta:
        model = Cameras
        fields = ['id', 'name', 'cameraIP', 'status', 'isRecording', 'isStreaming', 'isAnalytics', 
                  'lastLive', 'location', 'location_name', 'rtspurl', 'regDate', 'updateDate']
        read_only_fields = ['id', 'regDate', 'updateDate']
    
    def get_location_name(self, obj):
        """Fetch location name from Location model using location ID"""
        if obj.location:
            try:
                location = Location.objects.get(id=obj.location)
                return location.name
            except Location.DoesNotExist:
                return None
        return None
    
    def get_location_name(self, obj):
        """Fetch location name from Location model using location ID"""
        if obj.location:
            try:
                location = Location.objects.get(id=obj.location)
                return location.name
            except Location.DoesNotExist:
                return None
        return None
    
    def get_zone_name(self, obj):
        """Fetch zone name from Zone model using zone ID"""
        if obj.zone:
            try:
                zone = Zone.objects.get(id=obj.zone)
                return zone.name
            except Zone.DoesNotExist:
                return None
        return None

#group       
class GroupsSerializer(serializers.ModelSerializer):
    class Meta:
        model = Groups
        fields = '__all__'
        
#nvr
class NvrSerializer(serializers.ModelSerializer):
    zone_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    zone_name = serializers.SerializerMethodField(read_only=True)
    
    class Meta:
        model = Nvr
        fields = ['id', 'name', 'nvrip', 'port', 'username', 'password', 'nvrtype', 'model', 
                  'location', 'make', 'zone_id', 'zone_name', 'status', 'regDate', 'img', 
                  'responsible_Person', 'userid']
        extra_kwargs = {
            'zone': {'write_only': True}
        }
    
    def get_zone_name(self, obj):
        """Fetch zone name from Zone model using zone ID"""
        if obj.zone:
            try:
                zone_id = int(obj.zone) if isinstance(obj.zone, str) else obj.zone
                zone = Zone.objects.get(id=zone_id)
                return zone.name
            except (Zone.DoesNotExist, ValueError, TypeError):
                return None
        return None
    
    def create(self, validated_data):
        """Handle zone_id during creation"""
        zone_id = validated_data.pop('zone_id', None)
        if zone_id is not None:
            validated_data['zone'] = zone_id
        return super().create(validated_data)
    
    def update(self, instance, validated_data):
        """Handle zone_id during update"""
        zone_id = validated_data.pop('zone_id', None)
        if zone_id is not None:
            validated_data['zone'] = zone_id
        return super().update(instance, validated_data)
        
#Numberplatedetections   
class NumberplatedetectionsSerializer(serializers.ModelSerializer):
    class Meta:
        model = Numberplatedetections
        fields = '__all__'
        
class ReadedvehiclenoplatesSerializer(serializers.ModelSerializer):
    camera_name = serializers.CharField(source='cameraId.name', read_only=True)
    camera_location = serializers.CharField(source='cameraId.location', read_only=True)
    camera_area = serializers.CharField(source='cameraId.area', read_only=True)
    class Meta:
        model = Readedvehiclenoplates
        fields = '__all__'
        
class RolesSerializer(serializers.ModelSerializer):
    class Meta:
        model = Roles
        fields = '__all__'
        
class LocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Location
        fields = '__all__'
        

class LocationSummarySerializer(serializers.Serializer):
    locationName = serializers.CharField(allow_blank=True, allow_null=True)
    state = serializers.CharField(allow_blank=True, allow_null=True)
    city = serializers.CharField(allow_blank=True, allow_null=True)
    pinCode = serializers.CharField(allow_blank=True, allow_null=True)
    cameraCount = serializers.IntegerField()
    fireCount = serializers.IntegerField()
    smokeCount = serializers.IntegerField()
    rodantCount = serializers.IntegerField()
    
class ZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Zone
        fields = '__all__'
        
class UsersSerializer(serializers.ModelSerializer):
    class Meta:
        model = Users
        fields = '__all__'
        
class VehicledetectionsSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vehicledetections
        fields = '__all__'
        
class VideoanalyticsSerializer(serializers.ModelSerializer):
    class Meta:
        model = Videoanalytics
        fields = '__all__'

class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = '__all__'
        
class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=255)
    password = serializers.CharField(write_only=True)

class GodownSerializer(serializers.ModelSerializer):
    class Meta:
        model = Godown
        fields = '__all__'

class ColumnSerializer(serializers.ModelSerializer):
    class Meta:
        model = Column
        fields = '__all__'

class CameragodownmappingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cameragodownmapping
        fields = '__all__'

class AlertDetailsSerializer(serializers.Serializer):
    cameraIP = serializers.CharField(allow_blank=True, allow_null=True)
    cameraName = serializers.CharField(allow_blank=True, allow_null=True)
    locationName = serializers.CharField(allow_blank=True, allow_null=True)
    shadName = serializers.CharField(allow_blank=True, allow_null=True)
    columnName = serializers.CharField(allow_blank=True, allow_null=True)
    state = serializers.CharField(allow_blank=True, allow_null=True)
    pinCode = serializers.CharField(allow_blank=True, allow_null=True)
    city = serializers.CharField(allow_blank=True, allow_null=True)
    cameraId = serializers.IntegerField()
    imagePath = serializers.CharField(allow_blank=True, allow_null=True)
    alertType = serializers.CharField(allow_blank=True, allow_null=True)
    alertDateTime = serializers.DateTimeField()

# class MlModelsSerializer(serializers.ModelSerializer):
#     class Meta:
#         model = MlModels
#         fields = '__all__'

class DetectionGroupsSerializer(serializers.ModelSerializer):
    class Meta:
        model = DetectionGroups
        fields = '__all__'

class CameraDetectionMappingSerializer(serializers.ModelSerializer):
    detectionModels = serializers.ListField(
        child=serializers.CharField(),
        write_only=True
    )

    class Meta:
        model = CameraDetectionMapping
        fields = '__all__'

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        # Convert string "fire,smoke" to list of strings for the response
        if instance.detectionModels:
            ret['detectionModels'] = [x.strip() for x in instance.detectionModels.split(',') if x.strip()]
        else:
            ret['detectionModels'] = []
        return ret

    def to_internal_value(self, data):
        # Gracefully handle comma-separated strings if passed instead of a list
        if hasattr(data, 'getlist'):
            models_val = data.get('detectionModels')
            if isinstance(models_val, str):
                data = data.copy()
                data.setlist('detectionModels', [x.strip() for x in models_val.split(',') if x.strip()])
        elif isinstance(data, dict):
            models_val = data.get('detectionModels')
            if isinstance(models_val, str):
                data = dict(data)
                data['detectionModels'] = [x.strip() for x in models_val.split(',') if x.strip()]
                
        ret = super().to_internal_value(data)
        if 'detectionModels' in ret and isinstance(ret['detectionModels'], list):
            ret['detectionModels'] = ','.join(map(str, ret['detectionModels']))
        return ret