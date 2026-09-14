export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          new_data: Json | null
          old_data: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      collaborator_trainings: {
        Row: {
          collaborator_id: string
          completed_at: string
          created_at: string
          document_url: string | null
          expires_at: string | null
          id: string
          training_id: string
          updated_at: string
        }
        Insert: {
          collaborator_id: string
          completed_at: string
          created_at?: string
          document_url?: string | null
          expires_at?: string | null
          id?: string
          training_id: string
          updated_at?: string
        }
        Update: {
          collaborator_id?: string
          completed_at?: string
          created_at?: string
          document_url?: string | null
          expires_at?: string | null
          id?: string
          training_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_trainings_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_trainings_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: false
            referencedRelation: "trainings"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborators: {
        Row: {
          birth_date: string | null
          cpf: string | null
          created_at: string
          department_id: string | null
          driver_license_category: string | null
          driver_license_expiry: string | null
          email: string | null
          full_name: string
          hire_date: string | null
          id: string
          is_driver: boolean
          notes: string | null
          phone: string | null
          photo_url: string | null
          position_id: string | null
          registration_number: string
          sector_id: string | null
          social_name: string | null
          status: Database["public"]["Enums"]["collaborator_status"]
          supervisor_id: string | null
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          department_id?: string | null
          driver_license_category?: string | null
          driver_license_expiry?: string | null
          email?: string | null
          full_name: string
          hire_date?: string | null
          id?: string
          is_driver?: boolean
          notes?: string | null
          phone?: string | null
          photo_url?: string | null
          position_id?: string | null
          registration_number: string
          sector_id?: string | null
          social_name?: string | null
          status?: Database["public"]["Enums"]["collaborator_status"]
          supervisor_id?: string | null
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          department_id?: string | null
          driver_license_category?: string | null
          driver_license_expiry?: string | null
          email?: string | null
          full_name?: string
          hire_date?: string | null
          id?: string
          is_driver?: boolean
          notes?: string | null
          phone?: string | null
          photo_url?: string | null
          position_id?: string | null
          registration_number?: string
          sector_id?: string | null
          social_name?: string | null
          status?: Database["public"]["Enums"]["collaborator_status"]
          supervisor_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborators_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborators_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborators_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborators_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_allocations: {
        Row: {
          collaborator_id: string
          confirmation_status: Database["public"]["Enums"]["confirmation_status"]
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          driver: boolean
          has_pending_requirement: boolean
          id: string
          notes: string | null
          overnight: boolean
          position_id: string | null
          schedule_id: string
          sort_order: number
          source: Database["public"]["Enums"]["allocation_source"]
          updated_at: string
          vehicle_id: string | null
          work_id: string
        }
        Insert: {
          collaborator_id: string
          confirmation_status?: Database["public"]["Enums"]["confirmation_status"]
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          driver?: boolean
          has_pending_requirement?: boolean
          id?: string
          notes?: string | null
          overnight?: boolean
          position_id?: string | null
          schedule_id: string
          sort_order?: number
          source?: Database["public"]["Enums"]["allocation_source"]
          updated_at?: string
          vehicle_id?: string | null
          work_id: string
        }
        Update: {
          collaborator_id?: string
          confirmation_status?: Database["public"]["Enums"]["confirmation_status"]
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          driver?: boolean
          has_pending_requirement?: boolean
          id?: string
          notes?: string | null
          overnight?: boolean
          position_id?: string | null
          schedule_id?: string
          sort_order?: number
          source?: Database["public"]["Enums"]["allocation_source"]
          updated_at?: string
          vehicle_id?: string | null
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_allocations_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_allocations_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_allocations_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "daily_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_allocations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_allocations_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_schedules: {
        Row: {
          copied_from_schedule_id: string | null
          created_at: string
          created_by: string | null
          finalized_at: string | null
          id: string
          schedule_date: string
          status: Database["public"]["Enums"]["schedule_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          copied_from_schedule_id?: string | null
          created_at?: string
          created_by?: string | null
          finalized_at?: string | null
          id?: string
          schedule_date: string
          status?: Database["public"]["Enums"]["schedule_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          copied_from_schedule_id?: string | null
          created_at?: string
          created_by?: string | null
          finalized_at?: string | null
          id?: string
          schedule_date?: string
          status?: Database["public"]["Enums"]["schedule_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_schedules_copied_from_schedule_id_fkey"
            columns: ["copied_from_schedule_id"]
            isOneToOne: false
            referencedRelation: "daily_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      days_off: {
        Row: {
          collaborator_id: string
          created_at: string
          date: string
          id: string
          notes: string | null
          reason: string | null
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          date: string
          id?: string
          notes?: string | null
          reason?: string | null
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "days_off_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      holidays: {
        Row: {
          created_at: string
          date: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      medical_leaves: {
        Row: {
          collaborator_id: string
          created_at: string
          document_url: string | null
          end_date: string
          id: string
          notes: string | null
          start_date: string
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          document_url?: string | null
          end_date: string
          id?: string
          notes?: string | null
          start_date: string
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          document_url?: string | null
          end_date?: string
          id?: string
          notes?: string | null
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_leaves_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      sectors: {
        Row: {
          active: boolean
          created_at: string
          department_id: string | null
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          department_id?: string | null
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          department_id?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "sectors_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      trainings: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          name: string
          validity_months: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          validity_months?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          validity_months?: number
        }
        Relationships: []
      }
      transport_allocations: {
        Row: {
          created_at: string
          departure_time: string | null
          driver_id: string | null
          id: string
          notes: string | null
          passenger_count: number
          return_time: string | null
          schedule_id: string
          updated_at: string
          vehicle_id: string | null
          work_id: string
        }
        Insert: {
          created_at?: string
          departure_time?: string | null
          driver_id?: string | null
          id?: string
          notes?: string | null
          passenger_count?: number
          return_time?: string | null
          schedule_id: string
          updated_at?: string
          vehicle_id?: string | null
          work_id: string
        }
        Update: {
          created_at?: string
          departure_time?: string | null
          driver_id?: string | null
          id?: string
          notes?: string | null
          passenger_count?: number
          return_time?: string | null
          schedule_id?: string
          updated_at?: string
          vehicle_id?: string | null
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transport_allocations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_allocations_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "daily_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_allocations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_allocations_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_voucher_rules: {
        Row: {
          active: boolean
          amount: number
          applies_to_collaborators: boolean
          applies_to_drivers: boolean
          calculation_type: string
          created_at: string
          id: string
          maximum_distance: number | null
          minimum_distance: number
          name: string
        }
        Insert: {
          active?: boolean
          amount?: number
          applies_to_collaborators?: boolean
          applies_to_drivers?: boolean
          calculation_type?: string
          created_at?: string
          id?: string
          maximum_distance?: number | null
          minimum_distance?: number
          name: string
        }
        Update: {
          active?: boolean
          amount?: number
          applies_to_collaborators?: boolean
          applies_to_drivers?: boolean
          calculation_type?: string
          created_at?: string
          id?: string
          maximum_distance?: number | null
          minimum_distance?: number
          name?: string
        }
        Relationships: []
      }
      travel_bonus_rules: {
        Row: {
          active: boolean
          bonus_amount: number
          calculation_type: Database["public"]["Enums"]["bonus_calculation_type"]
          created_at: string
          id: string
          maximum_distance: number | null
          minimum_distance: number
        }
        Insert: {
          active?: boolean
          bonus_amount?: number
          calculation_type?: Database["public"]["Enums"]["bonus_calculation_type"]
          created_at?: string
          id?: string
          maximum_distance?: number | null
          minimum_distance?: number
        }
        Update: {
          active?: boolean
          bonus_amount?: number
          calculation_type?: Database["public"]["Enums"]["bonus_calculation_type"]
          created_at?: string
          id?: string
          maximum_distance?: number | null
          minimum_distance?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      users_profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      vacations: {
        Row: {
          collaborator_id: string
          created_at: string
          end_date: string
          id: string
          notes: string | null
          start_date: string
          status: string
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          end_date: string
          id?: string
          notes?: string | null
          start_date: string
          status?: string
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          end_date?: string
          id?: string
          notes?: string | null
          start_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacations_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          brand: string | null
          color: string | null
          created_at: string
          fuel_type: string | null
          id: string
          model: string | null
          notes: string | null
          passenger_capacity: number
          plate: string
          status: Database["public"]["Enums"]["vehicle_status"]
          type: string | null
          updated_at: string
          year: number | null
        }
        Insert: {
          brand?: string | null
          color?: string | null
          created_at?: string
          fuel_type?: string | null
          id?: string
          model?: string | null
          notes?: string | null
          passenger_capacity?: number
          plate: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          type?: string | null
          updated_at?: string
          year?: number | null
        }
        Update: {
          brand?: string | null
          color?: string | null
          created_at?: string
          fuel_type?: string | null
          id?: string
          model?: string | null
          notes?: string | null
          passenger_capacity?: number
          plate?: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          type?: string | null
          updated_at?: string
          year?: number | null
        }
        Relationships: []
      }
      work_base_teams: {
        Row: {
          active: boolean
          collaborator_id: string
          created_at: string
          end_date: string | null
          id: string
          notes: string | null
          position_id: string | null
          start_date: string
          updated_at: string
          work_id: string
        }
        Insert: {
          active?: boolean
          collaborator_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          position_id?: string | null
          start_date?: string
          updated_at?: string
          work_id: string
        }
        Update: {
          active?: boolean
          collaborator_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          position_id?: string | null
          start_date?: string
          updated_at?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_base_teams_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_base_teams_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_base_teams_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      work_requirements: {
        Row: {
          active: boolean
          blocking: boolean
          created_at: string
          id: string
          mandatory: boolean
          requirement_id: string | null
          requirement_label: string | null
          requirement_type: Database["public"]["Enums"]["requirement_type"]
          work_id: string
        }
        Insert: {
          active?: boolean
          blocking?: boolean
          created_at?: string
          id?: string
          mandatory?: boolean
          requirement_id?: string | null
          requirement_label?: string | null
          requirement_type: Database["public"]["Enums"]["requirement_type"]
          work_id: string
        }
        Update: {
          active?: boolean
          blocking?: boolean
          created_at?: string
          id?: string
          mandatory?: boolean
          requirement_id?: string | null
          requirement_label?: string | null
          requirement_type?: Database["public"]["Enums"]["requirement_type"]
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_requirements_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      works: {
        Row: {
          active: boolean
          address: string | null
          city: string | null
          client: string | null
          code: string
          created_at: string
          distance_km: number | null
          entry_time: string | null
          estimated_travel_time: number | null
          exit_time: string | null
          expected_end_date: string | null
          id: string
          latitude: number | null
          longitude: number | null
          manager_id: string | null
          name: string
          neighborhood: string | null
          notes: string | null
          number: string | null
          start_date: string | null
          state: string | null
          status: Database["public"]["Enums"]["work_status"]
          supervisor_id: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          city?: string | null
          client?: string | null
          code: string
          created_at?: string
          distance_km?: number | null
          entry_time?: string | null
          estimated_travel_time?: number | null
          exit_time?: string | null
          expected_end_date?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          manager_id?: string | null
          name: string
          neighborhood?: string | null
          notes?: string | null
          number?: string | null
          start_date?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["work_status"]
          supervisor_id?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          city?: string | null
          client?: string | null
          code?: string
          created_at?: string
          distance_km?: number | null
          entry_time?: string | null
          estimated_travel_time?: number | null
          exit_time?: string | null
          expected_end_date?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          manager_id?: string | null
          name?: string
          neighborhood?: string | null
          notes?: string | null
          number?: string | null
          start_date?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["work_status"]
          supervisor_id?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "works_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "works_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_write: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      allocation_source: "base_team" | "copied_previous_day" | "manual"
      app_role: "admin" | "programmer" | "viewer"
      bonus_calculation_type: "daily" | "trip" | "round_trip" | "overnight"
      collaborator_status: "active" | "inactive"
      confirmation_status: "confirmed" | "pending"
      requirement_type:
        | "training"
        | "certification"
        | "position"
        | "driver_license"
        | "medical_exam"
        | "custom"
      schedule_status: "draft" | "in_progress" | "finalized"
      training_status: "valid" | "expiring" | "expired"
      vehicle_status: "available" | "in_use" | "maintenance" | "inactive"
      work_status: "planned" | "active" | "paused" | "completed" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      allocation_source: ["base_team", "copied_previous_day", "manual"],
      app_role: ["admin", "programmer", "viewer"],
      bonus_calculation_type: ["daily", "trip", "round_trip", "overnight"],
      collaborator_status: ["active", "inactive"],
      confirmation_status: ["confirmed", "pending"],
      requirement_type: [
        "training",
        "certification",
        "position",
        "driver_license",
        "medical_exam",
        "custom",
      ],
      schedule_status: ["draft", "in_progress", "finalized"],
      training_status: ["valid", "expiring", "expired"],
      vehicle_status: ["available", "in_use", "maintenance", "inactive"],
      work_status: ["planned", "active", "paused", "completed", "cancelled"],
    },
  },
} as const
