
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, AlertCircle, Save } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { fetchData, putData } from '@/lib/api';
import { logger } from '@/lib/logger';

// Define the module structure for permissions
const permissionModules = [
  { id: 'products', label: 'Products', description: 'Manage product catalog' },
  { id: 'orders', label: 'Orders', description: 'Manage customer orders' },
  { id: 'inventory', label: 'Inventory', description: 'Manage inventory levels' },
  { id: 'users', label: 'Users', description: 'Manage system users' },
  { id: 'stores', label: 'Stores', description: 'Manage store locations' },
];

// Define permission actions
const permissionActions = [
  { id: 'create', label: 'Create', description: 'Add new items' },
  { id: 'read', label: 'View', description: 'View existing items' },
  { id: 'update', label: 'Update', description: 'Modify existing items' },
  { id: 'delete', label: 'Delete', description: 'Remove items' },
];

// Define interfaces
interface PermissionActions {
  create?: boolean;
  read?: boolean;
  update?: boolean;
  delete?: boolean;
}

interface Permissions {
  [module: string]: PermissionActions;
}

interface Role {
  id: number;
  name: string;
  description: string | null;
  permissions: Permissions;
  roleTypeId: number;
  createdAt: string;
  updatedAt: string;
  roleType: {
    id: number;
    description: string;
  };
}

function RolePermissionsPage() {
  const { id } = useParams<{ id: string }>();
  const roleId = id ? parseInt(id) : 0;
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Local state for permissions
  const [permissions, setPermissions] = useState<Permissions>({});
  const [isChanged, setIsChanged] = useState(false);
  
  // Fetch role data
  const { data: role, isLoading, isError, error } = useQuery<Role>({
    queryKey: [`/api/roles/${roleId}`],
    queryFn: () => fetchData(`/roles/${roleId}`),
    enabled: roleId > 0,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
  
  // Update permissions when role data is loaded
  useEffect(() => {
    if (role?.permissions) {
      setPermissions(role.permissions);
    }
  }, [role]);
  
  // Permission update mutation
  const updateMutation = useMutation({
    mutationFn: (permissions: Permissions) => {
      logger.info('Updating role permissions', { roleId, permissions });
      return putData(`/roles/${roleId}/permissions`, { permissions });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/roles/${roleId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/roles'] });
      setIsChanged(false);
      toast({
        title: "Success",
        description: "Role permissions updated successfully",
      });
    },
    onError: (error: Error) => {
      logger.error('Error updating permissions', { error });
      toast({
        title: "Error",
        description: error.message || "Failed to update permissions",
        variant: "destructive",
      });
    },
  });
  
  // Handle permission change
  const handlePermissionChange = (module: string, action: string, value: boolean) => {
    setPermissions(prev => {
      const newPermissions = { ...prev };
      
      // Initialize module if it doesn't exist
      if (!newPermissions[module]) {
        newPermissions[module] = {};
      }
      
      // Set the action value
      newPermissions[module] = { 
        ...newPermissions[module], 
        [action]: value 
      };
      
      return newPermissions;
    });
    
    setIsChanged(true);
  };
  
  // Handle save permissions
  const handleSave = () => {
    if (isChanged && roleId) {
      updateMutation.mutate(permissions);
    }
  };
  
  // Handle go back
  const handleBack = () => {
    navigate('/roles');
  };
  
  // Check if admin role (can't modify admin permissions)
  const isAdminRole = role?.name === 'admin';
  
  if (isLoading) {
    return (
      <div className="container py-6">
        <Skeleton className="h-12 w-3/4 mb-6" />
        <div className="grid gap-6">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </div>
    );
  }
  
  if (isError) {
    return (
      <div className="container py-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load role permissions'}
          </AlertDescription>
        </Alert>
        <Button onClick={handleBack} className="mt-4">Back to Roles</Button>
      </div>
    );
  }
  
  if (!role) {
    return (
      <div className="container py-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Not Found</AlertTitle>
          <AlertDescription>
            The requested role was not found.
          </AlertDescription>
        </Alert>
        <Button onClick={handleBack} className="mt-4">Back to Roles</Button>
      </div>
    );
  }
  
  return (
    <div className="container py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{role.name} Permissions</h1>
          <p className="text-muted-foreground mt-1">{role.description}</p>
          <div className="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground mt-2">
            {role.roleType.description}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleBack}>Cancel</Button>
          <Button 
            onClick={handleSave} 
            disabled={!isChanged || isAdminRole || updateMutation.isPending}
          >
            {updateMutation.isPending && (
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            Save Changes
          </Button>
        </div>
      </div>
      
      {isAdminRole && (
        <Alert className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Admin Role</AlertTitle>
          <AlertDescription>
            The admin role permissions cannot be modified as it always has full access to all system features.
          </AlertDescription>
        </Alert>
      )}
      
      <div className="grid gap-6">
        {permissionModules.map(module => (
          <Card key={module.id}>
            <CardHeader>
              <CardTitle>{module.label}</CardTitle>
              <CardDescription>{module.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {permissionActions.map(action => (
                  <div key={action.id} className="flex items-center space-x-2">
                    <Checkbox 
                      id={`${module.id}-${action.id}`}
                      checked={permissions[module.id]?.[action.id] || false}
                      onCheckedChange={(checked) => 
                        handlePermissionChange(module.id, action.id, checked === true)
                      }
                      disabled={isAdminRole}
                    />
                    <label
                      htmlFor={`${module.id}-${action.id}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {action.label}
                    </label>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default RolePermissionsPage;
