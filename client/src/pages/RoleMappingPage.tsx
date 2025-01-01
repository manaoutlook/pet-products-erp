import { useCallback, useLayoutEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Panel,
  Controls,
  Background,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, Users, Shield } from "lucide-react";

interface RoleNode {
  id: number;
  name: string;
  description: string;
  roleLocation: {
    id: number;
    description: string;
  };
  users: {
    id: number;
    username: string;
  }[];
  permissions: Record<string, Record<string, boolean>>;
}

function RoleMappingPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const { data: roleMapping, isLoading } = useQuery<{
    roles: RoleNode[];
    connections: { source: string; target: string }[];
  }>({
    queryKey: ['/api/roles/mapping'],
  });

  // Layout calculation
  const calculateLayout = useCallback(() => {
    if (!roleMapping) return;

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Create nodes for role locations (top level)
    const roleLocationMap = new Map();
    roleMapping.roles.forEach(role => {
      if (!roleLocationMap.has(role.roleLocation.id)) {
        roleLocationMap.set(role.roleLocation.id, {
          ...role.roleLocation,
          roles: []
        });
      }
      roleLocationMap.get(role.roleLocation.id).roles.push(role);
    });

    // Calculate positions
    const verticalSpacing = 150;
    const horizontalSpacing = 300;

    // Add role location nodes
    Array.from(roleLocationMap.entries()).forEach(([locationId, locationData]: [number, any], locationIndex) => {
      // Role location node
      newNodes.push({
        id: `location-${locationId}`,
        position: { x: locationIndex * horizontalSpacing, y: 0 },
        data: { label: locationData.description },
        className: 'bg-primary text-primary-foreground rounded-lg p-4 shadow-lg',
        style: { width: 200 },
      });

      // Add role nodes for this location
      locationData.roles.forEach((role: RoleNode, roleIndex: number) => {
        const roleNodeId = `role-${role.id}`;
        newNodes.push({
          id: roleNodeId,
          position: { 
            x: locationIndex * horizontalSpacing, 
            y: (roleIndex + 1) * verticalSpacing 
          },
          data: { 
            label: (
              <div className="p-2">
                <div className="font-bold">{role.name}</div>
                <div className="text-sm text-muted-foreground">{role.description}</div>
                <div className="mt-2 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <span>{role.users.length} users</span>
                </div>
              </div>
            )
          },
          className: 'border rounded-lg shadow-md bg-card',
        });

        // Connect role location to role
        newEdges.push({
          id: `edge-${locationId}-${role.id}`,
          source: `location-${locationId}`,
          target: roleNodeId,
          type: 'smoothstep',
          markerEnd: {
            type: MarkerType.ArrowClosed,
          },
          className: 'text-muted-foreground',
        });

        // Add user nodes
        role.users.forEach((user, userIndex) => {
          const userNodeId = `user-${user.id}`;
          newNodes.push({
            id: userNodeId,
            position: { 
              x: (locationIndex * horizontalSpacing) + 150, 
              y: ((roleIndex + 1) * verticalSpacing) + ((userIndex + 1) * 80) 
            },
            data: { 
              label: (
                <div className="p-2">
                  <div className="font-medium">{user.username}</div>
                </div>
              )
            },
            className: 'bg-accent text-accent-foreground rounded-lg shadow-sm',
          });

          // Connect role to user
          newEdges.push({
            id: `edge-${role.id}-${user.id}`,
            source: roleNodeId,
            target: userNodeId,
            type: 'smoothstep',
            markerEnd: {
              type: MarkerType.ArrowClosed,
            },
            className: 'text-muted-foreground',
          });
        });
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [roleMapping, setNodes, setEdges]);

  // Recalculate layout when data changes
  useLayoutEffect(() => {
    calculateLayout();
  }, [calculateLayout]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Role Mapping</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Role Hierarchy Visualization
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ height: '70vh' }} className="border rounded-lg">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              fitView
            >
              <Panel position="top-left" className="bg-background/80 p-2 rounded-lg shadow-md">
                <div className="text-sm space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-primary" />
                    <span>Role Locations</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-card border" />
                    <span>Roles</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-accent" />
                    <span>Users</span>
                  </div>
                </div>
              </Panel>
              <Controls />
              <Background />
            </ReactFlow>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default RoleMappingPage;