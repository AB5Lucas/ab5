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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      andam_asset_values: {
        Row: {
          acquired_at: string | null
          acquisition_value: number
          item_id: string
          rental_value_month: number
          replacement_value: number
          updated_at: string
          useful_life_months: number
        }
        Insert: {
          acquired_at?: string | null
          acquisition_value?: number
          item_id: string
          rental_value_month?: number
          replacement_value?: number
          updated_at?: string
          useful_life_months?: number
        }
        Update: {
          acquired_at?: string | null
          acquisition_value?: number
          item_id?: string
          rental_value_month?: number
          replacement_value?: number
          updated_at?: string
          useful_life_months?: number
        }
        Relationships: [
          {
            foreignKeyName: "andam_asset_values_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "andam_items"
            referencedColumns: ["id"]
          },
        ]
      }
      andam_flow_roles: {
        Row: {
          key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      andam_inventory: {
        Row: {
          client_id: string | null
          created_at: string
          finalized_at: string | null
          finalized_by: string | null
          id: string
          inventory_date: string
          location: string
          notes: string | null
          number: number
          status: string
          updated_at: string
          user_id: string | null
          work_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          inventory_date?: string
          location?: string
          notes?: string | null
          number?: number
          status?: string
          updated_at?: string
          user_id?: string | null
          work_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          inventory_date?: string
          location?: string
          notes?: string | null
          number?: number
          status?: string
          updated_at?: string
          user_id?: string | null
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "andam_inventory_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "andam_inventory_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      andam_inventory_items: {
        Row: {
          counted_qty: number | null
          id: string
          inventory_id: string
          item_id: string
          notes: string | null
          system_qty: number
        }
        Insert: {
          counted_qty?: number | null
          id?: string
          inventory_id: string
          item_id: string
          notes?: string | null
          system_qty?: number
        }
        Update: {
          counted_qty?: number | null
          id?: string
          inventory_id?: string
          item_id?: string
          notes?: string | null
          system_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "andam_inventory_items_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "andam_inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "andam_inventory_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "andam_items"
            referencedColumns: ["id"]
          },
        ]
      }
      andam_items: {
        Row: {
          active: boolean
          category: string | null
          code: string | null
          created_at: string
          description: string | null
          id: string
          min_stock: number
          name: string
          notes: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          min_stock?: number
          name: string
          notes?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          min_stock?: number
          name?: string
          notes?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      andam_movements: {
        Row: {
          created_at: string
          from_client_id: string | null
          from_location: string | null
          from_work_id: string | null
          id: string
          inventory_id: string | null
          item_id: string
          kind: string
          notes: string | null
          quantity: number
          to_client_id: string | null
          to_location: string | null
          to_work_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          from_client_id?: string | null
          from_location?: string | null
          from_work_id?: string | null
          id?: string
          inventory_id?: string | null
          item_id: string
          kind: string
          notes?: string | null
          quantity: number
          to_client_id?: string | null
          to_location?: string | null
          to_work_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          from_client_id?: string | null
          from_location?: string | null
          from_work_id?: string | null
          id?: string
          inventory_id?: string | null
          item_id?: string
          kind?: string
          notes?: string | null
          quantity?: number
          to_client_id?: string | null
          to_location?: string | null
          to_work_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "andam_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "andam_items"
            referencedColumns: ["id"]
          },
        ]
      }
      andam_request_events: {
        Row: {
          action: string
          created_at: string
          from_stage: string | null
          id: string
          note: string | null
          request_id: string
          to_stage: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          from_stage?: string | null
          id?: string
          note?: string | null
          request_id: string
          to_stage?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          from_stage?: string | null
          id?: string
          note?: string | null
          request_id?: string
          to_stage?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "andam_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "andam_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      andam_request_items: {
        Row: {
          id: string
          item_id: string
          purchase_status: string | null
          request_id: string
          requested_qty: number
          separated_qty: number
        }
        Insert: {
          id?: string
          item_id: string
          purchase_status?: string | null
          request_id: string
          requested_qty: number
          separated_qty?: number
        }
        Update: {
          id?: string
          item_id?: string
          purchase_status?: string | null
          request_id?: string
          requested_qty?: number
          separated_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "andam_request_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "andam_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "andam_request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "andam_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      andam_requests: {
        Row: {
          client_id: string
          created_at: string
          flow_stage: string
          id: string
          needed_date: string | null
          notes: string | null
          number: number
          priority: string
          request_date: string
          status: string
          updated_at: string
          user_id: string | null
          work_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          flow_stage?: string
          id?: string
          needed_date?: string | null
          notes?: string | null
          number?: number
          priority?: string
          request_date?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          work_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          flow_stage?: string
          id?: string
          needed_date?: string | null
          notes?: string | null
          number?: number
          priority?: string
          request_date?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "andam_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "andam_requests_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      andam_romaneio_items: {
        Row: {
          id: string
          item_id: string
          requested_qty: number
          ret_bom: number
          ret_danificado: number
          ret_inutilizado: number
          ret_manutencao: number
          ret_quebrado: number
          romaneio_id: string
          sent_qty: number
          separated_qty: number
        }
        Insert: {
          id?: string
          item_id: string
          requested_qty?: number
          ret_bom?: number
          ret_danificado?: number
          ret_inutilizado?: number
          ret_manutencao?: number
          ret_quebrado?: number
          romaneio_id: string
          sent_qty?: number
          separated_qty?: number
        }
        Update: {
          id?: string
          item_id?: string
          requested_qty?: number
          ret_bom?: number
          ret_danificado?: number
          ret_inutilizado?: number
          ret_manutencao?: number
          ret_quebrado?: number
          romaneio_id?: string
          sent_qty?: number
          separated_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "andam_romaneio_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "andam_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "andam_romaneio_items_romaneio_id_fkey"
            columns: ["romaneio_id"]
            isOneToOne: false
            referencedRelation: "andam_romaneios"
            referencedColumns: ["id"]
          },
        ]
      }
      andam_romaneios: {
        Row: {
          client_id: string
          created_at: string
          id: string
          kind: string
          notes: string | null
          number: number
          received_at: string | null
          request_id: string | null
          returned_at: string | null
          romaneio_date: string
          sent_at: string | null
          status: string
          updated_at: string
          user_id: string | null
          work_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          number?: number
          received_at?: string | null
          request_id?: string | null
          returned_at?: string | null
          romaneio_date?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          work_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          number?: number
          received_at?: string | null
          request_id?: string | null
          returned_at?: string | null
          romaneio_date?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "andam_romaneios_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "andam_romaneios_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "andam_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "andam_romaneios_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      andam_stock: {
        Row: {
          client_id: string | null
          id: string
          item_id: string
          location: string
          quantity: number
          updated_at: string
          work_id: string | null
        }
        Insert: {
          client_id?: string | null
          id?: string
          item_id: string
          location: string
          quantity?: number
          updated_at?: string
          work_id?: string | null
        }
        Update: {
          client_id?: string | null
          id?: string
          item_id?: string
          location?: string
          quantity?: number
          updated_at?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "andam_stock_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "andam_stock_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "andam_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "andam_stock_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      andam_structure_items: {
        Row: {
          id: string
          item_id: string
          quantity: number
          structure_id: string
        }
        Insert: {
          id?: string
          item_id: string
          quantity?: number
          structure_id: string
        }
        Update: {
          id?: string
          item_id?: string
          quantity?: number
          structure_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "andam_structure_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "andam_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "andam_structure_items_structure_id_fkey"
            columns: ["structure_id"]
            isOneToOne: false
            referencedRelation: "andam_structures"
            referencedColumns: ["id"]
          },
        ]
      }
      andam_structures: {
        Row: {
          art_file_path: string | null
          art_number: string | null
          assembled_at: string | null
          client_id: string
          created_at: string
          created_by: string | null
          dismantled_at: string | null
          has_project_art: boolean
          id: string
          inspection_valid_until: string | null
          location_desc: string | null
          notes: string | null
          order_code: string | null
          photos: Json
          project_file_path: string | null
          project_number: string | null
          released_at: string | null
          responsible: string | null
          status: string
          updated_at: string
          work_id: string | null
        }
        Insert: {
          art_file_path?: string | null
          art_number?: string | null
          assembled_at?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          dismantled_at?: string | null
          has_project_art?: boolean
          id?: string
          inspection_valid_until?: string | null
          location_desc?: string | null
          notes?: string | null
          order_code?: string | null
          photos?: Json
          project_file_path?: string | null
          project_number?: string | null
          released_at?: string | null
          responsible?: string | null
          status?: string
          updated_at?: string
          work_id?: string | null
        }
        Update: {
          art_file_path?: string | null
          art_number?: string | null
          assembled_at?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          dismantled_at?: string | null
          has_project_art?: boolean
          id?: string
          inspection_valid_until?: string | null
          location_desc?: string | null
          notes?: string | null
          order_code?: string | null
          photos?: Json
          project_file_path?: string | null
          project_number?: string | null
          released_at?: string | null
          responsible?: string | null
          status?: string
          updated_at?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "andam_structures_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "andam_structures_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          client_booked: boolean
          client_id: string | null
          collaborator_id: string
          completed_at: string | null
          completed_date: string | null
          completed_time: string | null
          created_at: string
          id: string
          notes: string | null
          original_date: string | null
          original_time: string | null
          pays_transport_voucher: boolean
          reschedules: Json
          scheduled_date: string
          scheduled_time: string | null
          status: string
          training_id: string | null
          type: string
          updated_at: string
          work_id: string | null
        }
        Insert: {
          client_booked?: boolean
          client_id?: string | null
          collaborator_id: string
          completed_at?: string | null
          completed_date?: string | null
          completed_time?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          original_date?: string | null
          original_time?: string | null
          pays_transport_voucher?: boolean
          reschedules?: Json
          scheduled_date: string
          scheduled_time?: string | null
          status?: string
          training_id?: string | null
          type: string
          updated_at?: string
          work_id?: string | null
        }
        Update: {
          client_booked?: boolean
          client_id?: string | null
          collaborator_id?: string
          completed_at?: string | null
          completed_date?: string | null
          completed_time?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          original_date?: string | null
          original_time?: string | null
          pays_transport_voucher?: boolean
          reschedules?: Json
          scheduled_date?: string
          scheduled_time?: string | null
          status?: string
          training_id?: string | null
          type?: string
          updated_at?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: false
            referencedRelation: "trainings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      asos: {
        Row: {
          collaborator_id: string
          created_at: string
          exam_date: string
          expires_at: string
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          exam_date: string
          expires_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          exam_date?: string
          expires_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asos_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_lists: {
        Row: {
          id: string
          issued_at: string
          issued_by: string | null
          snapshot: Json
          training_date: string
          training_id: string
          tst_id: string | null
          version: number
        }
        Insert: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          snapshot: Json
          training_date: string
          training_id: string
          tst_id?: string | null
          version?: number
        }
        Update: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          snapshot?: Json
          training_date?: string
          training_id?: string
          tst_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "attendance_lists_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: false
            referencedRelation: "trainings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_lists_tst_id_fkey"
            columns: ["tst_id"]
            isOneToOne: false
            referencedRelation: "tst_instructors"
            referencedColumns: ["id"]
          },
        ]
      }
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
      backup_industry_orders_20261110: {
        Row: {
          aliases: string[] | null
          amount: number | null
          client_name: string | null
          created_at: string | null
          id: string | null
          issue: string | null
          lines: Json | null
          manual_work_id: string | null
          order_date: string | null
          order_number: string | null
          raw_material: number | null
          ref_month: string | null
          service_code: string | null
          source_file: string | null
          splits: Json | null
          status: string | null
          updated_at: string | null
          work_id: string | null
        }
        Insert: {
          aliases?: string[] | null
          amount?: number | null
          client_name?: string | null
          created_at?: string | null
          id?: string | null
          issue?: string | null
          lines?: Json | null
          manual_work_id?: string | null
          order_date?: string | null
          order_number?: string | null
          raw_material?: number | null
          ref_month?: string | null
          service_code?: string | null
          source_file?: string | null
          splits?: Json | null
          status?: string | null
          updated_at?: string | null
          work_id?: string | null
        }
        Update: {
          aliases?: string[] | null
          amount?: number | null
          client_name?: string | null
          created_at?: string | null
          id?: string | null
          issue?: string | null
          lines?: Json | null
          manual_work_id?: string | null
          order_date?: string | null
          order_number?: string | null
          raw_material?: number | null
          ref_month?: string | null
          service_code?: string | null
          source_file?: string | null
          splits?: Json | null
          status?: string | null
          updated_at?: string | null
          work_id?: string | null
        }
        Relationships: []
      }
      backup_works_orders_20261110: {
        Row: {
          id: string | null
          orders: Json | null
        }
        Insert: {
          id?: string | null
          orders?: Json | null
        }
        Update: {
          id?: string | null
          orders?: Json | null
        }
        Relationships: []
      }
      billing_client_equivalences: {
        Row: {
          client_id: string
          source_key: string
          source_name: string
          updated_at: string
        }
        Insert: {
          client_id: string
          source_key: string
          source_name: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          source_key?: string
          source_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_client_equivalences_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_sync_history: {
        Row: {
          action: string
          happened_at: string
          id: string
          note_id: string | null
          run_id: string | null
          snapshot: Json
        }
        Insert: {
          action: string
          happened_at?: string
          id?: string
          note_id?: string | null
          run_id?: string | null
          snapshot: Json
        }
        Update: {
          action?: string
          happened_at?: string
          id?: string
          note_id?: string | null
          run_id?: string | null
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "billing_sync_history_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "billing_sync_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_sync_history_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "billing_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_sync_notes: {
        Row: {
          amount: number
          cancelled: boolean
          cancelled_at: string | null
          client_name: string
          decision: Json
          difference_cents: number | null
          entry_id: string | null
          expected_cents: number | null
          id: string
          invoice_number: string
          issued_at: string
          last_attempt_at: string
          method: string | null
          order_number: string | null
          original: Json
          quote_number: string | null
          reason: string | null
          run_id: string | null
          source_key: string
          status: string
          tolerance_cents: number
          work_id: string | null
        }
        Insert: {
          amount: number
          cancelled?: boolean
          cancelled_at?: string | null
          client_name: string
          decision?: Json
          difference_cents?: number | null
          entry_id?: string | null
          expected_cents?: number | null
          id?: string
          invoice_number: string
          issued_at: string
          last_attempt_at?: string
          method?: string | null
          order_number?: string | null
          original: Json
          quote_number?: string | null
          reason?: string | null
          run_id?: string | null
          source_key: string
          status?: string
          tolerance_cents?: number
          work_id?: string | null
        }
        Update: {
          amount?: number
          cancelled?: boolean
          cancelled_at?: string | null
          client_name?: string
          decision?: Json
          difference_cents?: number | null
          entry_id?: string | null
          expected_cents?: number | null
          id?: string
          invoice_number?: string
          issued_at?: string
          last_attempt_at?: string
          method?: string | null
          order_number?: string | null
          original?: Json
          quote_number?: string | null
          reason?: string | null
          run_id?: string | null
          source_key?: string
          status?: string
          tolerance_cents?: number
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_sync_notes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "billing_sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_sync_notes_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_sync_runs: {
        Row: {
          analyzed: number
          cancelled: number
          category: string
          error_message: string | null
          errors: number
          file_path: string | null
          finished_at: string | null
          id: string
          ignored: number
          inserted: number
          pending: number
          ref_month: string | null
          source: string
          started_at: string
          status: string
          trigger_kind: string
          updated: number
        }
        Insert: {
          analyzed?: number
          cancelled?: number
          category?: string
          error_message?: string | null
          errors?: number
          file_path?: string | null
          finished_at?: string | null
          id?: string
          ignored?: number
          inserted?: number
          pending?: number
          ref_month?: string | null
          source?: string
          started_at?: string
          status?: string
          trigger_kind?: string
          updated?: number
        }
        Update: {
          analyzed?: number
          cancelled?: number
          category?: string
          error_message?: string | null
          errors?: number
          file_path?: string | null
          finished_at?: string | null
          id?: string
          ignored?: number
          inserted?: number
          pending?: number
          ref_month?: string | null
          source?: string
          started_at?: string
          status?: string
          trigger_kind?: string
          updated?: number
        }
        Relationships: []
      }
      billing_sync_settings: {
        Row: {
          id: boolean
          tolerance_cents: number
          updated_at: string
        }
        Insert: {
          id?: boolean
          tolerance_cents?: number
          updated_at?: string
        }
        Update: {
          id?: boolean
          tolerance_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      city_distances: {
        Row: {
          city_a: string
          city_b: string
          created_at: string
          id: string
          km: number
        }
        Insert: {
          city_a: string
          city_b: string
          created_at?: string
          id?: string
          km: number
        }
        Update: {
          city_a?: string
          city_b?: string
          created_at?: string
          id?: string
          km?: number
        }
        Relationships: []
      }
      client_integrations: {
        Row: {
          client_id: string
          collaborator_id: string
          created_at: string
          documentation: boolean
          expires_at: string | null
          id: string
          integration_date: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          collaborator_id: string
          created_at?: string
          documentation?: boolean
          expires_at?: string | null
          id?: string
          integration_date?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          collaborator_id?: string
          created_at?: string
          documentation?: boolean
          expires_at?: string | null
          id?: string
          integration_date?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_integrations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_integrations_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          active: boolean
          address: string | null
          cc_prefix: string | null
          city: string | null
          created_at: string
          distance_km: number | null
          has_toll: boolean
          id: string
          name: string
          needs_company_transport: boolean
          needs_transport_voucher: boolean
          neighborhood: string | null
          notes: string | null
          number: string | null
          requires_integration: boolean
          state: string | null
          toll_amount: number
          trips_per_day: number
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          cc_prefix?: string | null
          city?: string | null
          created_at?: string
          distance_km?: number | null
          has_toll?: boolean
          id?: string
          name: string
          needs_company_transport?: boolean
          needs_transport_voucher?: boolean
          neighborhood?: string | null
          notes?: string | null
          number?: string | null
          requires_integration?: boolean
          state?: string | null
          toll_amount?: number
          trips_per_day?: number
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          cc_prefix?: string | null
          city?: string | null
          created_at?: string
          distance_km?: number | null
          has_toll?: boolean
          id?: string
          name?: string
          needs_company_transport?: boolean
          needs_transport_voucher?: boolean
          neighborhood?: string | null
          notes?: string | null
          number?: string | null
          requires_integration?: boolean
          state?: string | null
          toll_amount?: number
          trips_per_day?: number
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      closing_adjustments: {
        Row: {
          amount: number
          collaborator_id: string
          created_at: string
          created_by: string | null
          description: string | null
          entry_date: string
          id: string
          kind: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          collaborator_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date: string
          id?: string
          kind: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          collaborator_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date?: string
          id?: string
          kind?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "closing_adjustments_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      closing_foreman_priority: {
        Row: {
          collaborator_id: string
          created_at: string
          id: string
          sort_order: number
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          id?: string
          sort_order?: number
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "closing_foreman_priority_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: true
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
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
          city: string | null
          contract_type: Database["public"]["Enums"]["contract_type"] | null
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
          no_overtime_premium: boolean
          notes: string | null
          phone: string | null
          photo_url: string | null
          position_id: string | null
          registration_number: string
          rg: string | null
          salary: number | null
          sector_id: string | null
          shift_id: string | null
          social_name: string | null
          status: Database["public"]["Enums"]["collaborator_status"]
          supervisor_id: string | null
          travel_bonus_enabled: boolean
          updated_at: string
          vt_enabled: boolean
        }
        Insert: {
          birth_date?: string | null
          city?: string | null
          contract_type?: Database["public"]["Enums"]["contract_type"] | null
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
          no_overtime_premium?: boolean
          notes?: string | null
          phone?: string | null
          photo_url?: string | null
          position_id?: string | null
          registration_number: string
          rg?: string | null
          salary?: number | null
          sector_id?: string | null
          shift_id?: string | null
          social_name?: string | null
          status?: Database["public"]["Enums"]["collaborator_status"]
          supervisor_id?: string | null
          travel_bonus_enabled?: boolean
          updated_at?: string
          vt_enabled?: boolean
        }
        Update: {
          birth_date?: string | null
          city?: string | null
          contract_type?: Database["public"]["Enums"]["contract_type"] | null
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
          no_overtime_premium?: boolean
          notes?: string | null
          phone?: string | null
          photo_url?: string | null
          position_id?: string | null
          registration_number?: string
          rg?: string | null
          salary?: number | null
          sector_id?: string | null
          shift_id?: string | null
          social_name?: string | null
          status?: Database["public"]["Enums"]["collaborator_status"]
          supervisor_id?: string | null
          travel_bonus_enabled?: boolean
          updated_at?: string
          vt_enabled?: boolean
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
            foreignKeyName: "collaborators_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "work_shifts"
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
      conference_checks: {
        Row: {
          approved: boolean
          approved_at: string | null
          client_id: string
          created_at: string
          id: string
          item_id: string
          next_check_date: string | null
          updated_at: string
        }
        Insert: {
          approved?: boolean
          approved_at?: string | null
          client_id: string
          created_at?: string
          id?: string
          item_id: string
          next_check_date?: string | null
          updated_at?: string
        }
        Update: {
          approved?: boolean
          approved_at?: string | null
          client_id?: string
          created_at?: string
          id?: string
          item_id?: string
          next_check_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_checks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_checks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "conference_items"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_items: {
        Row: {
          appointment_id: string | null
          client_id: string | null
          collaborator_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          document_date: string
          id: string
          notes: string | null
          status: string
          training_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          client_id?: string | null
          collaborator_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          document_date: string
          id?: string
          notes?: string | null
          status?: string
          training_id?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          client_id?: string | null
          collaborator_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          document_date?: string
          id?: string
          notes?: string | null
          status?: string
          training_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_items_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_items_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_items_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: false
            referencedRelation: "trainings"
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
          service_assigned: boolean
          sort_order: number
          source: Database["public"]["Enums"]["allocation_source"]
          travel_bonus_override: boolean | null
          updated_at: string
          vehicle_id: string | null
          vt_override: boolean | null
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
          service_assigned?: boolean
          sort_order?: number
          source?: Database["public"]["Enums"]["allocation_source"]
          travel_bonus_override?: boolean | null
          updated_at?: string
          vehicle_id?: string | null
          vt_override?: boolean | null
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
          service_assigned?: boolean
          sort_order?: number
          source?: Database["public"]["Enums"]["allocation_source"]
          travel_bonus_override?: boolean | null
          updated_at?: string
          vehicle_id?: string | null
          vt_override?: boolean | null
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
      daily_status_entries: {
        Row: {
          box_key: string
          collaborator_id: string
          created_at: string
          id: string
          notes: string | null
          schedule_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          box_key: string
          collaborator_id: string
          created_at?: string
          id?: string
          notes?: string | null
          schedule_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          box_key?: string
          collaborator_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          schedule_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_status_entries_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_status_entries_schedule_id_fkey"
            columns: ["schedule_id"]
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
          end_date: string | null
          id: string
          notes: string | null
          reason: string | null
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          date: string
          end_date?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          date?: string
          end_date?: string | null
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
      driver_bonus_rules: {
        Row: {
          active: boolean
          amount: number
          calculation_type: string
          created_at: string
          id: string
          maximum_distance: number | null
          minimum_distance: number
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount?: number
          calculation_type?: string
          created_at?: string
          id?: string
          maximum_distance?: number | null
          minimum_distance?: number
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount?: number
          calculation_type?: string
          created_at?: string
          id?: string
          maximum_distance?: number | null
          minimum_distance?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      epi_sheets: {
        Row: {
          archived: boolean
          collaborator_id: string
          created_at: string
          delivered_at: string | null
          expires_at: string | null
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          archived?: boolean
          collaborator_id: string
          created_at?: string
          delivered_at?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          archived?: boolean
          collaborator_id?: string
          created_at?: string
          delivered_at?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "epi_sheets_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: true
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_expense_files: {
        Row: {
          file_path: string
          rows: number
          source: string
          synced_at: string
        }
        Insert: {
          file_path: string
          rows?: number
          source: string
          synced_at?: string
        }
        Update: {
          file_path?: string
          rows?: number
          source?: string
          synced_at?: string
        }
        Relationships: []
      }
      fleet_expenses: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          document: string | null
          expense_date: string
          file_path: string
          id: string
          plate: string
          source: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          document?: string | null
          expense_date: string
          file_path: string
          id?: string
          plate: string
          source: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          document?: string | null
          expense_date?: string
          file_path?: string
          id?: string
          plate?: string
          source?: string
        }
        Relationships: []
      }
      foreman_works: {
        Row: {
          created_at: string
          id: string
          user_id: string
          work_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
          work_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "foreman_works_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      hiring_email_config_history: {
        Row: {
          active: boolean | null
          cc_emails: string[] | null
          changed_at: string
          changed_by: string | null
          client_id: string
          id: string
          notes: string | null
          to_emails: string[] | null
        }
        Insert: {
          active?: boolean | null
          cc_emails?: string[] | null
          changed_at?: string
          changed_by?: string | null
          client_id: string
          id?: string
          notes?: string | null
          to_emails?: string[] | null
        }
        Update: {
          active?: boolean | null
          cc_emails?: string[] | null
          changed_at?: string
          changed_by?: string | null
          client_id?: string
          id?: string
          notes?: string | null
          to_emails?: string[] | null
        }
        Relationships: []
      }
      hiring_email_configs: {
        Row: {
          active: boolean
          cc_emails: string[]
          client_id: string
          notes: string | null
          to_emails: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          cc_emails?: string[]
          client_id: string
          notes?: string | null
          to_emails?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          cc_emails?: string[]
          client_id?: string
          notes?: string | null
          to_emails?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hiring_email_configs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      hiring_email_log: {
        Row: {
          cc_emails: string[]
          created_at: string
          error: string | null
          event: string
          event_id: string | null
          id: string
          request_id: string
          result: string
          to_emails: string[]
        }
        Insert: {
          cc_emails?: string[]
          created_at?: string
          error?: string | null
          event: string
          event_id?: string | null
          id?: string
          request_id: string
          result: string
          to_emails?: string[]
        }
        Update: {
          cc_emails?: string[]
          created_at?: string
          error?: string | null
          event?: string
          event_id?: string | null
          id?: string
          request_id?: string
          result?: string
          to_emails?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "hiring_email_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "hiring_request_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hiring_email_log_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "hiring_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      hiring_request_events: {
        Row: {
          created_at: string
          event: string
          filled: number | null
          id: string
          new_status: string | null
          note: string | null
          old_status: string | null
          request_id: string
          user_id: string
          user_name: string | null
        }
        Insert: {
          created_at?: string
          event: string
          filled?: number | null
          id?: string
          new_status?: string | null
          note?: string | null
          old_status?: string | null
          request_id: string
          user_id?: string
          user_name?: string | null
        }
        Update: {
          created_at?: string
          event?: string
          filled?: number | null
          id?: string
          new_status?: string | null
          note?: string | null
          old_status?: string | null
          request_id?: string
          user_id?: string
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hiring_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "hiring_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      hiring_requests: {
        Row: {
          client_id: string
          created_at: string
          desired_date: string | null
          filled: number
          id: string
          notes: string | null
          number: number
          position_id: string | null
          position_name: string
          priority: string
          quantity: number
          reason: string
          requester_id: string
          requester_name: string | null
          rh_owner_id: string | null
          rh_owner_name: string | null
          status: string
          updated_at: string
          work_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          desired_date?: string | null
          filled?: number
          id?: string
          notes?: string | null
          number?: never
          position_id?: string | null
          position_name: string
          priority?: string
          quantity: number
          reason: string
          requester_id?: string
          requester_name?: string | null
          rh_owner_id?: string | null
          rh_owner_name?: string | null
          status?: string
          updated_at?: string
          work_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          desired_date?: string | null
          filled?: number
          id?: string
          notes?: string | null
          number?: never
          position_id?: string | null
          position_name?: string
          priority?: string
          quantity?: number
          reason?: string
          requester_id?: string
          requester_name?: string | null
          rh_owner_id?: string | null
          rh_owner_name?: string | null
          status?: string
          updated_at?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hiring_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hiring_requests_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hiring_requests_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
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
      industry_invoices: {
        Row: {
          amount: number
          client_name: string
          created_at: string
          id: string
          invoice_number: string
          issue: string | null
          issued_at: string
          items: Json
          order_id: string | null
          order_number: string | null
          ref_month: string
          reversed_at: string | null
          source_file: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          client_name: string
          created_at?: string
          id?: string
          invoice_number: string
          issue?: string | null
          issued_at: string
          items?: Json
          order_id?: string | null
          order_number?: string | null
          ref_month: string
          reversed_at?: string | null
          source_file?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          client_name?: string
          created_at?: string
          id?: string
          invoice_number?: string
          issue?: string | null
          issued_at?: string
          items?: Json
          order_id?: string | null
          order_number?: string | null
          ref_month?: string
          reversed_at?: string | null
          source_file?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "industry_invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "industry_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      industry_orders: {
        Row: {
          aliases: string[]
          amount: number
          client_name: string
          created_at: string
          id: string
          issue: string | null
          lines: Json | null
          manual_work_id: string | null
          order_date: string | null
          order_number: string
          raw_material: number | null
          ref_month: string
          service_code: string | null
          source_file: string | null
          splits: Json | null
          status: string
          updated_at: string
          work_id: string | null
        }
        Insert: {
          aliases?: string[]
          amount?: number
          client_name: string
          created_at?: string
          id?: string
          issue?: string | null
          lines?: Json | null
          manual_work_id?: string | null
          order_date?: string | null
          order_number: string
          raw_material?: number | null
          ref_month: string
          service_code?: string | null
          source_file?: string | null
          splits?: Json | null
          status?: string
          updated_at?: string
          work_id?: string | null
        }
        Update: {
          aliases?: string[]
          amount?: number
          client_name?: string
          created_at?: string
          id?: string
          issue?: string | null
          lines?: Json | null
          manual_work_id?: string | null
          order_date?: string | null
          order_number?: string
          raw_material?: number | null
          ref_month?: string
          service_code?: string | null
          source_file?: string | null
          splits?: Json | null
          status?: string
          updated_at?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "industry_orders_manual_work_id_fkey"
            columns: ["manual_work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "industry_orders_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
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
      prize_hours: {
        Row: {
          collaborator_id: string
          created_at: string
          created_by: string | null
          entry_date: string
          hourly_rate: number
          hours: number
          id: string
          multiplier: number
          updated_at: string
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          created_by?: string | null
          entry_date: string
          hourly_rate?: number
          hours: number
          id?: string
          multiplier?: number
          updated_at?: string
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          hourly_rate?: number
          hours?: number
          id?: string
          multiplier?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prize_hours_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_asset_decisions: {
        Row: {
          category: string
          decided_amount: number
          decided_by: string | null
          id: string
          is_asset: boolean
          item_key: string
          mode: string
          monthly_amount: number | null
          months: number
          purchase_cc_id: string
          target_client_id: string | null
          target_work_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          decided_amount?: number
          decided_by?: string | null
          id?: string
          is_asset?: boolean
          item_key: string
          mode?: string
          monthly_amount?: number | null
          months?: number
          purchase_cc_id: string
          target_client_id?: string | null
          target_work_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          decided_amount?: number
          decided_by?: string | null
          id?: string
          is_asset?: boolean
          item_key?: string
          mode?: string
          monthly_amount?: number | null
          months?: number
          purchase_cc_id?: string
          target_client_id?: string | null
          target_work_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_asset_decisions_purchase_cc_id_fkey"
            columns: ["purchase_cc_id"]
            isOneToOne: false
            referencedRelation: "purchase_cc_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_asset_decisions_target_client_id_fkey"
            columns: ["target_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_asset_decisions_target_work_id_fkey"
            columns: ["target_work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_cc_lines: {
        Row: {
          amount: number
          cc_code: string
          cc_name: string | null
          directed_by: string | null
          effective_cc: string | null
          excluded_amount: number
          file_path: string | null
          id: string
          item_states: Json
          items: Json
          launched_amount: number
          pending_amount: number
          reason: string | null
          ref_month: string
          status: string
          synced_at: string
          target_client_id: string | null
          target_work_id: string | null
        }
        Insert: {
          amount?: number
          cc_code: string
          cc_name?: string | null
          directed_by?: string | null
          effective_cc?: string | null
          excluded_amount?: number
          file_path?: string | null
          id?: string
          item_states?: Json
          items?: Json
          launched_amount?: number
          pending_amount?: number
          reason?: string | null
          ref_month: string
          status?: string
          synced_at?: string
          target_client_id?: string | null
          target_work_id?: string | null
        }
        Update: {
          amount?: number
          cc_code?: string
          cc_name?: string | null
          directed_by?: string | null
          effective_cc?: string | null
          excluded_amount?: number
          file_path?: string | null
          id?: string
          item_states?: Json
          items?: Json
          launched_amount?: number
          pending_amount?: number
          reason?: string | null
          ref_month?: string
          status?: string
          synced_at?: string
          target_client_id?: string | null
          target_work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_cc_lines_target_client_id_fkey"
            columns: ["target_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_cc_lines_target_work_id_fkey"
            columns: ["target_work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_cc_redirects: {
        Row: {
          active: boolean
          id: string
          source_cc: string
          target_cc: string
        }
        Insert: {
          active?: boolean
          id?: string
          source_cc: string
          target_cc: string
        }
        Update: {
          active?: boolean
          id?: string
          source_cc?: string
          target_cc?: string
        }
        Relationships: []
      }
      purchase_exclusion_rules: {
        Row: {
          active: boolean
          id: string
          match_type: string
          reason: string
          value: string
        }
        Insert: {
          active?: boolean
          id?: string
          match_type: string
          reason: string
          value: string
        }
        Update: {
          active?: boolean
          id?: string
          match_type?: string
          reason?: string
          value?: string
        }
        Relationships: []
      }
      rdo_media: {
        Row: {
          created_at: string
          description: string | null
          id: string
          kind: string
          rdo_id: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          rdo_id: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          rdo_id?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rdo_media_rdo_id_fkey"
            columns: ["rdo_id"]
            isOneToOne: false
            referencedRelation: "rdos"
            referencedColumns: ["id"]
          },
        ]
      }
      rdo_scaffolds: {
        Row: {
          created_at: string
          height_m: number | null
          id: string
          length_m: number | null
          location: string | null
          notes: string | null
          operation: string
          quantity: number
          rdo_id: string
          scaffold_type: string | null
          updated_at: string
          width_m: number | null
        }
        Insert: {
          created_at?: string
          height_m?: number | null
          id?: string
          length_m?: number | null
          location?: string | null
          notes?: string | null
          operation?: string
          quantity?: number
          rdo_id: string
          scaffold_type?: string | null
          updated_at?: string
          width_m?: number | null
        }
        Update: {
          created_at?: string
          height_m?: number | null
          id?: string
          length_m?: number | null
          location?: string | null
          notes?: string | null
          operation?: string
          quantity?: number
          rdo_id?: string
          scaffold_type?: string | null
          updated_at?: string
          width_m?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rdo_scaffolds_rdo_id_fkey"
            columns: ["rdo_id"]
            isOneToOne: false
            referencedRelation: "rdos"
            referencedColumns: ["id"]
          },
        ]
      }
      rdo_services: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          location: string | null
          notes: string | null
          productivity: number | null
          quantity: number | null
          rdo_id: string
          team: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          id?: string
          location?: string | null
          notes?: string | null
          productivity?: number | null
          quantity?: number | null
          rdo_id: string
          team?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          location?: string | null
          notes?: string | null
          productivity?: number | null
          quantity?: number | null
          rdo_id?: string
          team?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rdo_services_rdo_id_fkey"
            columns: ["rdo_id"]
            isOneToOne: false
            referencedRelation: "rdos"
            referencedColumns: ["id"]
          },
        ]
      }
      rdo_signatures: {
        Row: {
          created_at: string
          id: string
          kind: string
          rdo_id: string
          signature_data: string
          signed_at: string
          signer_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          rdo_id: string
          signature_data: string
          signed_at?: string
          signer_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          rdo_id?: string
          signature_data?: string
          signed_at?: string
          signer_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rdo_signatures_rdo_id_fkey"
            columns: ["rdo_id"]
            isOneToOne: false
            referencedRelation: "rdos"
            referencedColumns: ["id"]
          },
        ]
      }
      rdo_user_prefs: {
        Row: {
          created_at: string
          last_work_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_work_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          last_work_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rdo_user_prefs_last_work_id_fkey"
            columns: ["last_work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      rdo_workforce: {
        Row: {
          allocation_id: string | null
          break_minutes: number
          classified_at: string | null
          classified_by: string | null
          collaborator_id: string
          created_at: string
          entry_time: string | null
          exit_time: string | null
          final_classification: string | null
          id: string
          occurrence_status: string
          planned: boolean
          position_id: string | null
          present: boolean
          rdo_id: string
          report_date: string
          reported_note: string | null
          reported_reason: string | null
          updated_at: string
          work_id: string
          worked_hours: number | null
        }
        Insert: {
          allocation_id?: string | null
          break_minutes?: number
          classified_at?: string | null
          classified_by?: string | null
          collaborator_id: string
          created_at?: string
          entry_time?: string | null
          exit_time?: string | null
          final_classification?: string | null
          id?: string
          occurrence_status?: string
          planned?: boolean
          position_id?: string | null
          present?: boolean
          rdo_id: string
          report_date: string
          reported_note?: string | null
          reported_reason?: string | null
          updated_at?: string
          work_id: string
          worked_hours?: number | null
        }
        Update: {
          allocation_id?: string | null
          break_minutes?: number
          classified_at?: string | null
          classified_by?: string | null
          collaborator_id?: string
          created_at?: string
          entry_time?: string | null
          exit_time?: string | null
          final_classification?: string | null
          id?: string
          occurrence_status?: string
          planned?: boolean
          position_id?: string | null
          present?: boolean
          rdo_id?: string
          report_date?: string
          reported_note?: string | null
          reported_reason?: string | null
          updated_at?: string
          work_id?: string
          worked_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rdo_workforce_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "daily_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rdo_workforce_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rdo_workforce_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rdo_workforce_rdo_id_fkey"
            columns: ["rdo_id"]
            isOneToOne: false
            referencedRelation: "rdos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rdo_workforce_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      rdos: {
        Row: {
          activities: string | null
          client_id: string | null
          created_at: string
          finalized_at: string | null
          id: string
          notes: string | null
          number: number
          report_date: string
          responsible_name: string | null
          schedule_id: string | null
          shift: string
          status: string
          updated_at: string
          user_id: string | null
          work_id: string
        }
        Insert: {
          activities?: string | null
          client_id?: string | null
          created_at?: string
          finalized_at?: string | null
          id?: string
          notes?: string | null
          number?: number
          report_date: string
          responsible_name?: string | null
          schedule_id?: string | null
          shift?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          work_id: string
        }
        Update: {
          activities?: string | null
          client_id?: string | null
          created_at?: string
          finalized_at?: string | null
          id?: string
          notes?: string | null
          number?: number
          report_date?: string
          responsible_name?: string | null
          schedule_id?: string | null
          shift?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rdos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rdos_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "daily_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rdos_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      result_support_allocations: {
        Row: {
          client_id: string
          collaborator_id: string
          created_at: string
        }
        Insert: {
          client_id: string
          collaborator_id: string
          created_at?: string
        }
        Update: {
          client_id?: string
          collaborator_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_support_allocations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_support_allocations_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      role_page_access: {
        Row: {
          allowed: boolean
          path: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          allowed?: boolean
          path: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          allowed?: boolean
          path?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      schedule_box_titles: {
        Row: {
          box_key: string
          created_at: string
          id: string
          schedule_id: string
          title: string
          updated_at: string
        }
        Insert: {
          box_key: string
          created_at?: string
          id?: string
          schedule_id: string
          title: string
          updated_at?: string
        }
        Update: {
          box_key?: string
          created_at?: string
          id?: string
          schedule_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_box_titles_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "daily_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_box_vt: {
        Row: {
          box_key: string
          created_at: string
          id: string
          overnight: boolean
          pays_bonus: boolean
          pays_vt: boolean
          schedule_id: string
          updated_at: string
        }
        Insert: {
          box_key: string
          created_at?: string
          id?: string
          overnight?: boolean
          pays_bonus?: boolean
          pays_vt: boolean
          schedule_id: string
          updated_at?: string
        }
        Update: {
          box_key?: string
          created_at?: string
          id?: string
          overnight?: boolean
          pays_bonus?: boolean
          pays_vt?: boolean
          schedule_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_box_vt_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "daily_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_client_visibility: {
        Row: {
          client_id: string
          created_at: string
          id: string
          schedule_date: string
          updated_at: string
          visible: boolean
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          schedule_date: string
          updated_at?: string
          visible?: boolean
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          schedule_date?: string
          updated_at?: string
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "schedule_client_visibility_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_person_vt: {
        Row: {
          box_key: string
          collaborator_id: string
          created_at: string
          id: string
          overnight: boolean | null
          pays_bonus: boolean | null
          pays_vt: boolean
          schedule_id: string
          updated_at: string
        }
        Insert: {
          box_key: string
          collaborator_id: string
          created_at?: string
          id?: string
          overnight?: boolean | null
          pays_bonus?: boolean | null
          pays_vt: boolean
          schedule_id: string
          updated_at?: string
        }
        Update: {
          box_key?: string
          collaborator_id?: string
          created_at?: string
          id?: string
          overnight?: boolean | null
          pays_bonus?: boolean | null
          pays_vt?: boolean
          schedule_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_person_vt_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_person_vt_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "daily_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_work_night: {
        Row: {
          created_at: string
          id: string
          schedule_date: string
          work_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          schedule_date: string
          work_id: string
        }
        Update: {
          created_at?: string
          id?: string
          schedule_date?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_work_night_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_work_travel: {
        Row: {
          created_at: string
          id: string
          pays_bonus: boolean
          schedule_id: string
          updated_at: string
          work_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pays_bonus?: boolean
          schedule_id: string
          updated_at?: string
          work_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pays_bonus?: boolean
          schedule_id?: string
          updated_at?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_work_travel_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "daily_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_work_travel_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_work_vt: {
        Row: {
          created_at: string
          id: string
          pays_vt: boolean
          schedule_id: string
          updated_at: string
          work_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pays_vt?: boolean
          schedule_id: string
          updated_at?: string
          work_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pays_vt?: boolean
          schedule_id?: string
          updated_at?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_work_vt_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "daily_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_work_vt_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
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
      service_display_prefs: {
        Row: {
          client_id: string
          created_at: string
          hidden_work_ids: string[]
          id: string
          updated_at: string
          user_id: string
          work_order: string[]
        }
        Insert: {
          client_id: string
          created_at?: string
          hidden_work_ids?: string[]
          id?: string
          updated_at?: string
          user_id?: string
          work_order?: string[]
        }
        Update: {
          client_id?: string
          created_at?: string
          hidden_work_ids?: string[]
          id?: string
          updated_at?: string
          user_id?: string
          work_order?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "service_display_prefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      timeclock_adjustments: {
        Row: {
          created_at: string
          id: string
          kind: string
          rdo_workforce_id: string
          status: string
          treated_at: string
          treated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          rdo_workforce_id: string
          status?: string
          treated_at?: string
          treated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          rdo_workforce_id?: string
          status?: string
          treated_at?: string
          treated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timeclock_adjustments_rdo_workforce_id_fkey"
            columns: ["rdo_workforce_id"]
            isOneToOne: false
            referencedRelation: "rdo_workforce"
            referencedColumns: ["id"]
          },
        ]
      }
      training_cert_data: {
        Row: {
          cert_phrase: string | null
          code: string | null
          default_location: string | null
          is_periodic_label: boolean
          legal_basis: string | null
          norms: string | null
          objectives: string | null
          program: string | null
          schedule_text: string | null
          subject: string | null
          training_id: string
          training_title: string | null
          updated_at: string
          updated_by: string | null
          workload_hours: number | null
          workload_hours_periodic: number | null
        }
        Insert: {
          cert_phrase?: string | null
          code?: string | null
          default_location?: string | null
          is_periodic_label?: boolean
          legal_basis?: string | null
          norms?: string | null
          objectives?: string | null
          program?: string | null
          schedule_text?: string | null
          subject?: string | null
          training_id: string
          training_title?: string | null
          updated_at?: string
          updated_by?: string | null
          workload_hours?: number | null
          workload_hours_periodic?: number | null
        }
        Update: {
          cert_phrase?: string | null
          code?: string | null
          default_location?: string | null
          is_periodic_label?: boolean
          legal_basis?: string | null
          norms?: string | null
          objectives?: string | null
          program?: string | null
          schedule_text?: string | null
          subject?: string | null
          training_id?: string
          training_title?: string | null
          updated_at?: string
          updated_by?: string | null
          workload_hours?: number | null
          workload_hours_periodic?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "training_cert_data_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: true
            referencedRelation: "trainings"
            referencedColumns: ["id"]
          },
        ]
      }
      training_certificates: {
        Row: {
          collaborator_id: string
          id: string
          issued_at: string
          issued_by: string | null
          kind: string
          kind_manual: boolean
          snapshot: Json
          training_date: string
          training_id: string
          tst_id: string | null
          version: number
        }
        Insert: {
          collaborator_id: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          kind: string
          kind_manual?: boolean
          snapshot: Json
          training_date: string
          training_id: string
          tst_id?: string | null
          version?: number
        }
        Update: {
          collaborator_id?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          kind?: string
          kind_manual?: boolean
          snapshot?: Json
          training_date?: string
          training_id?: string
          tst_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_certificates_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_certificates_training_id_fkey"
            columns: ["training_id"]
            isOneToOne: false
            referencedRelation: "trainings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_certificates_tst_id_fkey"
            columns: ["tst_id"]
            isOneToOne: false
            referencedRelation: "tst_instructors"
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
          purpose: string
          return_time: string | null
          schedule_id: string
          updated_at: string
          vehicle_id: string | null
          work_id: string | null
        }
        Insert: {
          created_at?: string
          departure_time?: string | null
          driver_id?: string | null
          id?: string
          notes?: string | null
          passenger_count?: number
          purpose?: string
          return_time?: string | null
          schedule_id: string
          updated_at?: string
          vehicle_id?: string | null
          work_id?: string | null
        }
        Update: {
          created_at?: string
          departure_time?: string | null
          driver_id?: string | null
          id?: string
          notes?: string | null
          passenger_count?: number
          purpose?: string
          return_time?: string | null
          schedule_id?: string
          updated_at?: string
          vehicle_id?: string | null
          work_id?: string | null
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
      transport_passengers: {
        Row: {
          client_id: string
          collaborator_id: string
          created_at: string
          id: string
          schedule_date: string
          sort_order: number
          vehicle_schedule_id: string | null
        }
        Insert: {
          client_id: string
          collaborator_id: string
          created_at?: string
          id?: string
          schedule_date: string
          sort_order?: number
          vehicle_schedule_id?: string | null
        }
        Update: {
          client_id?: string
          collaborator_id?: string
          created_at?: string
          id?: string
          schedule_date?: string
          sort_order?: number
          vehicle_schedule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transport_passengers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_passengers_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_passengers_vehicle_schedule_id_fkey"
            columns: ["vehicle_schedule_id"]
            isOneToOne: false
            referencedRelation: "vehicle_schedules"
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
      tst_instructors: {
        Row: {
          active: boolean
          company: string | null
          council: string | null
          cpf: string | null
          created_at: string
          full_name: string
          id: string
          notes: string | null
          registration: string | null
          role_title: string | null
        }
        Insert: {
          active?: boolean
          company?: string | null
          council?: string | null
          cpf?: string | null
          created_at?: string
          full_name: string
          id?: string
          notes?: string | null
          registration?: string | null
          role_title?: string | null
        }
        Update: {
          active?: boolean
          company?: string | null
          council?: string | null
          cpf?: string | null
          created_at?: string
          full_name?: string
          id?: string
          notes?: string | null
          registration?: string | null
          role_title?: string | null
        }
        Relationships: []
      }
      user_page_access: {
        Row: {
          allowed: boolean
          id: string
          path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed: boolean
          id?: string
          path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed?: boolean
          id?: string
          path?: string
          updated_at?: string
          user_id?: string
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
      user_saved_signatures: {
        Row: {
          created_at: string
          signature_data: string
          signer_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          signature_data: string
          signer_name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          signature_data?: string
          signer_name?: string
          updated_at?: string
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
      va_overrides: {
        Row: {
          collaborator_id: string
          updated_at: string
          value: number
          ym: string
        }
        Insert: {
          collaborator_id: string
          updated_at?: string
          value: number
          ym: string
        }
        Update: {
          collaborator_id?: string
          updated_at?: string
          value?: number
          ym?: string
        }
        Relationships: []
      }
      va_settings: {
        Row: {
          abono_reasons: string[]
          base_value: number
          id: boolean
          justified_reasons: string[]
          pct1: number
          pct2: number
          pct3: number
          tolerance_min: number
          unjustified_reasons: string[]
          updated_at: string
        }
        Insert: {
          abono_reasons?: string[]
          base_value?: number
          id?: boolean
          justified_reasons?: string[]
          pct1?: number
          pct2?: number
          pct3?: number
          tolerance_min?: number
          unjustified_reasons?: string[]
          updated_at?: string
        }
        Update: {
          abono_reasons?: string[]
          base_value?: number
          id?: boolean
          justified_reasons?: string[]
          pct1?: number
          pct2?: number
          pct3?: number
          tolerance_min?: number
          unjustified_reasons?: string[]
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
      vehicle_schedules: {
        Row: {
          client_id: string | null
          created_at: string
          driver_bonus: boolean
          driver_id: string | null
          external_place: string | null
          extra_client_ids: string[]
          extra_driver_ids: string[]
          extra_km: number
          id: string
          is_external: boolean
          is_maintenance: boolean
          is_suzano_local: boolean
          km: number
          notes: string | null
          schedule_date: string
          trips: number
          updated_at: string
          vehicle_id: string
          work_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          driver_bonus?: boolean
          driver_id?: string | null
          external_place?: string | null
          extra_client_ids?: string[]
          extra_driver_ids?: string[]
          extra_km?: number
          id?: string
          is_external?: boolean
          is_maintenance?: boolean
          is_suzano_local?: boolean
          km?: number
          notes?: string | null
          schedule_date: string
          trips?: number
          updated_at?: string
          vehicle_id: string
          work_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          driver_bonus?: boolean
          driver_id?: string | null
          external_place?: string | null
          extra_client_ids?: string[]
          extra_driver_ids?: string[]
          extra_km?: number
          id?: string
          is_external?: boolean
          is_maintenance?: boolean
          is_suzano_local?: boolean
          km?: number
          notes?: string | null
          schedule_date?: string
          trips?: number
          updated_at?: string
          vehicle_id?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_schedules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_schedules_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_schedules_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_schedules_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_view_prefs: {
        Row: {
          created_at: string
          hidden_vehicle_ids: string[]
          updated_at: string
          user_id: string
          vehicle_order: string[]
        }
        Insert: {
          created_at?: string
          hidden_vehicle_ids?: string[]
          updated_at?: string
          user_id: string
          vehicle_order?: string[]
        }
        Update: {
          created_at?: string
          hidden_vehicle_ids?: string[]
          updated_at?: string
          user_id?: string
          vehicle_order?: string[]
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          assign_by_work: boolean
          brand: string | null
          color: string | null
          created_at: string
          fuel_type: string | null
          id: string
          km_rate: number | null
          model: string | null
          monthly_rent: number
          notes: string | null
          ownership: string
          passenger_capacity: number
          plate: string
          status: Database["public"]["Enums"]["vehicle_status"]
          type: string | null
          updated_at: string
          year: number | null
        }
        Insert: {
          assign_by_work?: boolean
          brand?: string | null
          color?: string | null
          created_at?: string
          fuel_type?: string | null
          id?: string
          km_rate?: number | null
          model?: string | null
          monthly_rent?: number
          notes?: string | null
          ownership?: string
          passenger_capacity?: number
          plate: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          type?: string | null
          updated_at?: string
          year?: number | null
        }
        Update: {
          assign_by_work?: boolean
          brand?: string | null
          color?: string | null
          created_at?: string
          fuel_type?: string | null
          id?: string
          km_rate?: number | null
          model?: string | null
          monthly_rent?: number
          notes?: string | null
          ownership?: string
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
      work_entries: {
        Row: {
          amount: number
          category: string
          competence_month: string | null
          created_at: string
          description: string | null
          entry_date: string
          id: string
          industry_invoice_id: string | null
          industry_order_id: string | null
          industry_part: string | null
          industry_part_ref: string | null
          purchase_cc_id: string | null
          purchase_item_key: string | null
          recurrence_id: string | null
          recurrence_month: string | null
          split_group: string | null
          split_note: string | null
          split_total: number | null
          sync_cancelled: boolean
          sync_note_id: string | null
          sync_split_note_id: string | null
          updated_at: string
          work_id: string
        }
        Insert: {
          amount?: number
          category: string
          competence_month?: string | null
          created_at?: string
          description?: string | null
          entry_date: string
          id?: string
          industry_invoice_id?: string | null
          industry_order_id?: string | null
          industry_part?: string | null
          industry_part_ref?: string | null
          purchase_cc_id?: string | null
          purchase_item_key?: string | null
          recurrence_id?: string | null
          recurrence_month?: string | null
          split_group?: string | null
          split_note?: string | null
          split_total?: number | null
          sync_cancelled?: boolean
          sync_note_id?: string | null
          sync_split_note_id?: string | null
          updated_at?: string
          work_id: string
        }
        Update: {
          amount?: number
          category?: string
          competence_month?: string | null
          created_at?: string
          description?: string | null
          entry_date?: string
          id?: string
          industry_invoice_id?: string | null
          industry_order_id?: string | null
          industry_part?: string | null
          industry_part_ref?: string | null
          purchase_cc_id?: string | null
          purchase_item_key?: string | null
          recurrence_id?: string | null
          recurrence_month?: string | null
          split_group?: string | null
          split_note?: string | null
          split_total?: number | null
          sync_cancelled?: boolean
          sync_note_id?: string | null
          sync_split_note_id?: string | null
          updated_at?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_entries_industry_invoice_id_fkey"
            columns: ["industry_invoice_id"]
            isOneToOne: false
            referencedRelation: "industry_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_entries_industry_order_id_fkey"
            columns: ["industry_order_id"]
            isOneToOne: false
            referencedRelation: "industry_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_entries_purchase_cc_id_fkey"
            columns: ["purchase_cc_id"]
            isOneToOne: false
            referencedRelation: "purchase_cc_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_entries_recurrence_id_fkey"
            columns: ["recurrence_id"]
            isOneToOne: false
            referencedRelation: "work_entry_recurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_entries_sync_note_id_fkey"
            columns: ["sync_note_id"]
            isOneToOne: false
            referencedRelation: "billing_sync_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_entries_sync_split_note_id_fkey"
            columns: ["sync_split_note_id"]
            isOneToOne: false
            referencedRelation: "billing_sync_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_entries_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      work_entry_recurrences: {
        Row: {
          active: boolean
          amount: number
          category: string
          created_at: string
          created_by: string | null
          description: string
          end_month: string | null
          id: string
          start_month: string
          updated_at: string
          work_id: string
        }
        Insert: {
          active?: boolean
          amount: number
          category: string
          created_at?: string
          created_by?: string | null
          description?: string
          end_month?: string | null
          id?: string
          start_month: string
          updated_at?: string
          work_id: string
        }
        Update: {
          active?: boolean
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          end_month?: string | null
          id?: string
          start_month?: string
          updated_at?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_entry_recurrences_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      work_progress: {
        Row: {
          created_at: string
          id: string
          month: string
          percent: number
          updated_at: string
          work_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          month: string
          percent?: number
          updated_at?: string
          work_id: string
        }
        Update: {
          created_at?: string
          id?: string
          month?: string
          percent?: number
          updated_at?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_progress_work_id_fkey"
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
      work_shifts: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_default: boolean
          name: string
          schedule: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          schedule?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          schedule?: Json
          updated_at?: string
        }
        Relationships: []
      }
      works: {
        Row: {
          active: boolean
          address: string | null
          budget_cost: number
          budget_items: Json
          cc_suffix: string | null
          city: string | null
          client: string | null
          client_id: string | null
          code: string | null
          contract_enabled: boolean
          contract_months: number
          created_at: string
          distance_km: number | null
          entry_time: string | null
          estimated_travel_time: number | null
          exit_time: string | null
          exit_time_weekend: string | null
          expected_end_date: string | null
          hh_enabled: boolean
          hh_rates: Json
          id: string
          latitude: number | null
          longitude: number | null
          manager_id: string | null
          monthly_enabled: boolean
          name: string
          neighborhood: string | null
          night_shift: boolean
          notes: string | null
          number: string | null
          order_number: string | null
          order_value: number
          orders: Json
          quote_number: string | null
          rdo_general: boolean
          rental_enabled: boolean
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
          budget_cost?: number
          budget_items?: Json
          cc_suffix?: string | null
          city?: string | null
          client?: string | null
          client_id?: string | null
          code?: string | null
          contract_enabled?: boolean
          contract_months?: number
          created_at?: string
          distance_km?: number | null
          entry_time?: string | null
          estimated_travel_time?: number | null
          exit_time?: string | null
          exit_time_weekend?: string | null
          expected_end_date?: string | null
          hh_enabled?: boolean
          hh_rates?: Json
          id?: string
          latitude?: number | null
          longitude?: number | null
          manager_id?: string | null
          monthly_enabled?: boolean
          name: string
          neighborhood?: string | null
          night_shift?: boolean
          notes?: string | null
          number?: string | null
          order_number?: string | null
          order_value?: number
          orders?: Json
          quote_number?: string | null
          rdo_general?: boolean
          rental_enabled?: boolean
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
          budget_cost?: number
          budget_items?: Json
          cc_suffix?: string | null
          city?: string | null
          client?: string | null
          client_id?: string | null
          code?: string | null
          contract_enabled?: boolean
          contract_months?: number
          created_at?: string
          distance_km?: number | null
          entry_time?: string | null
          estimated_travel_time?: number | null
          exit_time?: string | null
          exit_time_weekend?: string | null
          expected_end_date?: string | null
          hh_enabled?: boolean
          hh_rates?: Json
          id?: string
          latitude?: number | null
          longitude?: number | null
          manager_id?: string | null
          monthly_enabled?: boolean
          name?: string
          neighborhood?: string | null
          night_shift?: boolean
          notes?: string | null
          number?: string | null
          order_number?: string | null
          order_value?: number
          orders?: Json
          quote_number?: string | null
          rdo_general?: boolean
          rental_enabled?: boolean
          start_date?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["work_status"]
          supervisor_id?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "works_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
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
      _andam_move: {
        Args: {
          _fc: string
          _fl: string
          _fw: string
          _item: string
          _kind: string
          _note: string
          _qty: number
          _tc: string
          _tl: string
          _tw: string
        }
        Returns: undefined
      }
      andam_adjust: {
        Args: {
          _client: string
          _delta: number
          _item: string
          _location: string
          _note: string
          _work: string
        }
        Returns: undefined
      }
      andam_can: { Args: { _page: string }; Returns: boolean }
      andam_client_ok: { Args: { _client: string }; Returns: boolean }
      andam_finalize_inventory: { Args: { _inv: string }; Returns: undefined }
      andam_flow_advance: {
        Args: { _action: string; _note?: string; _req: string }
        Returns: undefined
      }
      andam_flow_set_qty: {
        Args: { _field: string; _line: string; _qty: number }
        Returns: undefined
      }
      andam_flow_user: { Args: { _key: string }; Returns: boolean }
      andam_req_visible: { Args: { _req: string }; Returns: boolean }
      andam_romaneio_receive: { Args: { _rom: string }; Returns: undefined }
      andam_romaneio_return: { Args: { _rom: string }; Returns: undefined }
      andam_romaneio_send: { Args: { _rom: string }; Returns: undefined }
      andam_transfer: {
        Args: {
          _from_client: string
          _from_loc: string
          _from_work: string
          _item: string
          _note: string
          _qty: number
          _to_client: string
          _to_loc: string
          _to_work: string
        }
        Returns: undefined
      }
      billing_client_key: { Args: { v: string }; Returns: string }
      billing_client_normalized: { Args: { v: string }; Returns: string }
      billing_doc_key: { Args: { v: string }; Returns: string }
      billing_entry_desc: {
        Args: { p_note: Json; p_work: string }
        Returns: string
      }
      billing_entry_ref: {
        Args: { p_order: string; p_quote: string; p_work: string }
        Returns: string
      }
      billing_note_replace: {
        Args: { _entry: string; _note: string }
        Returns: undefined
      }
      billing_purge_cross_duplicates: { Args: never; Returns: Json }
      billing_quote_key: { Args: { v: string }; Returns: string }
      billing_sync_import_external: {
        Args: { p_notes: Json; p_run: string }
        Returns: Json
      }
      billing_sync_process: {
        Args: { p_notes: Json; p_run: string }
        Returns: Json
      }
      billing_sync_start: { Args: { p_kind?: string }; Returns: string }
      can_access_client: { Args: { _client_id: string }; Returns: boolean }
      can_access_page: { Args: { _path: string }; Returns: boolean }
      can_access_rdo: { Args: { _rdo_id: string }; Returns: boolean }
      can_access_work: { Args: { _work_id: string }; Returns: boolean }
      can_edit_rdo: { Args: { _rdo_id: string }; Returns: boolean }
      can_write: { Args: never; Returns: boolean }
      copy_service_split: {
        Args: { _client_id: string; _date: string }
        Returns: number
      }
      copy_transport_prev: {
        Args: { _client_id: string; _date: string }
        Returns: number
      }
      create_client_service: {
        Args: { _client_id: string; _name: string }
        Returns: string
      }
      driver_bonus_default: { Args: { _driver_id: string }; Returns: boolean }
      fleet_expenses_replace: {
        Args: { p_file: string; p_rows: Json; p_source: string }
        Returns: number
      }
      generate_recurring_entries: {
        Args: { _work_ids?: string[] }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hiring_mail_recipients: {
        Args: { _client_ids: string[] }
        Returns: {
          cc_emails: string[]
          client_id: string
          to_emails: string[]
        }[]
      }
      industry_add_work_order: {
        Args: { _date: string; _number: string; _value: number; _work: string }
        Returns: undefined
      }
      industry_invoice_launch: {
        Args: { _invoice: string; _work: string }
        Returns: number
      }
      industry_invoice_reverse: {
        Args: { _invoice: string }
        Returns: undefined
      }
      industry_order_assign: {
        Args: { _order: string; _work: string }
        Returns: number
      }
      industry_part_work: { Args: { _service: string }; Returns: string }
      industry_sync_apply: {
        Args: {
          p_file: string
          p_month: string
          p_rows: Json
          p_run: string
          p_source: string
        }
        Returns: Json
      }
      industry_sync_parts: { Args: { _oid: string }; Returns: undefined }
      is_active_user: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_cliente: { Args: never; Returns: boolean }
      is_hiring_rh: { Args: never; Returns: boolean }
      move_allocation_service: {
        Args: { _alloc_id: string; _work_id: string }
        Returns: undefined
      }
      prev_business_day: { Args: { _date: string }; Returns: string }
      purchase_apply_policy: {
        Args: { _entries: Json; _line: string; _summary: Json }
        Returns: number
      }
      purchase_replace_entries: {
        Args: {
          _entries: Json
          _line: string
          _reason: string
          _status: string
        }
        Returns: number
      }
      rdo_add_worker: {
        Args: {
          _collaborator_id: string
          _entry: string
          _exit: string
          _position_id: string
          _rdo_id: string
        }
        Returns: undefined
      }
      rdo_general_work: { Args: { _client_id: string }; Returns: string }
      rdo_report_absence: {
        Args: { _note: string; _reason: string; _wf_id: string }
        Returns: undefined
      }
      rdo_undo_absence: { Args: { _wf_id: string }; Returns: undefined }
      relocate_allocation_client: {
        Args: { _alloc_id: string; _client_id: string }
        Returns: undefined
      }
      set_transport_passenger: {
        Args: {
          _client_id: string
          _collaborator_id: string
          _date: string
          _remove?: boolean
          _vs_id: string
        }
        Returns: undefined
      }
      set_vehicle_driver: {
        Args: { _driver_id: string; _vs_id: string }
        Returns: undefined
      }
      title_case_name: { Args: { _name: string }; Returns: string }
      unassign_allocation_service: {
        Args: { _alloc_id: string }
        Returns: undefined
      }
      weekend_add_allocation: {
        Args: { _collaborator_id: string; _date: string; _work_id: string }
        Returns: string
      }
      weekend_add_vehicle: {
        Args: {
          _client_id: string
          _date: string
          _driver_id: string
          _vehicle_id: string
        }
        Returns: string
      }
      weekend_remove_allocation: {
        Args: { _alloc_id: string }
        Returns: undefined
      }
    }
    Enums: {
      allocation_source: "base_team" | "copied_previous_day" | "manual"
      app_role:
        | "admin"
        | "programmer"
        | "viewer"
        | "encarregado"
        | "coordenador"
        | "cliente"
      bonus_calculation_type: "daily" | "trip" | "round_trip" | "overnight"
      collaborator_status: "active" | "inactive"
      confirmation_status: "confirmed" | "pending"
      contract_type: "efetivo" | "pj" | "intermitente"
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
      app_role: [
        "admin",
        "programmer",
        "viewer",
        "encarregado",
        "coordenador",
        "cliente",
      ],
      bonus_calculation_type: ["daily", "trip", "round_trip", "overnight"],
      collaborator_status: ["active", "inactive"],
      confirmation_status: ["confirmed", "pending"],
      contract_type: ["efetivo", "pj", "intermitente"],
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
