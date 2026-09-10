export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_emails: {
        Row: {
          company_id: string | null
          created_at: string
          kind: string
          provider: string
          provider_id: string
          recipient_masked: string
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          kind: string
          provider: string
          provider_id: string
          recipient_masked: string
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          kind?: string
          provider?: string
          provider_id?: string
          recipient_masked?: string
          user_id?: string | null
        }
        Relationships: []
      }
      app_text_override: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          lang: string
          platform: string
          text_key: string
          updated_at: string
          value: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          lang: string
          platform: string
          text_key: string
          updated_at?: string
          value: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          lang?: string
          platform?: string
          text_key?: string
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_text_override_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      app_users: {
        Row: {
          company_id: string
          created_at: string
          email: string | null
          full_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email?: string | null
          full_name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string | null
          full_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_categories: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          track: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          track?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          track?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_documents: {
        Row: {
          asset_id: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          storage_path: string | null
        }
        Insert: {
          asset_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          storage_path?: string | null
        }
        Update: {
          asset_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_documents_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_events: {
        Row: {
          actor_user_id: string | null
          asset_id: string
          company_id: string
          created_at: string
          detail: Json
          event_type: string
          from_location_id: string | null
          from_status: Database["public"]["Enums"]["asset_status"] | null
          id: number
          to_location_id: string | null
          to_status: Database["public"]["Enums"]["asset_status"] | null
        }
        Insert: {
          actor_user_id?: string | null
          asset_id: string
          company_id: string
          created_at?: string
          detail?: Json
          event_type: string
          from_location_id?: string | null
          from_status?: Database["public"]["Enums"]["asset_status"] | null
          id?: never
          to_location_id?: string | null
          to_status?: Database["public"]["Enums"]["asset_status"] | null
        }
        Update: {
          actor_user_id?: string | null
          asset_id?: string
          company_id?: string
          created_at?: string
          detail?: Json
          event_type?: string
          from_location_id?: string | null
          from_status?: Database["public"]["Enums"]["asset_status"] | null
          id?: never
          to_location_id?: string | null
          to_status?: Database["public"]["Enums"]["asset_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_loan_notifications: {
        Row: {
          asset_id: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          company_id: string
          created_at: string
          error: string | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          lang: string
          loan_id: string
          provider_id: string | null
          recipient: string | null
          status: Database["public"]["Enums"]["notification_status"]
        }
        Insert: {
          asset_id?: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          company_id: string
          created_at?: string
          error?: string | null
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          lang?: string
          loan_id: string
          provider_id?: string | null
          recipient?: string | null
          status: Database["public"]["Enums"]["notification_status"]
        }
        Update: {
          asset_id?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          company_id?: string
          created_at?: string
          error?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          lang?: string
          loan_id?: string
          provider_id?: string | null
          recipient?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "asset_loan_notifications_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_loan_notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_loan_notifications_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "asset_loans"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_loans: {
        Row: {
          anonymized_at: string | null
          asset_id: string
          bounce_reason: string | null
          bounced_at: string | null
          company_id: string
          employee_id: string | null
          expires_at: string | null
          id: string
          lent_at: string
          lent_by: string | null
          note: string | null
          returned_at: string | null
          returned_by: string | null
          to_address: string | null
          to_email: string | null
          to_name: string
          to_phone: string | null
        }
        Insert: {
          anonymized_at?: string | null
          asset_id: string
          bounce_reason?: string | null
          bounced_at?: string | null
          company_id: string
          employee_id?: string | null
          expires_at?: string | null
          id?: string
          lent_at?: string
          lent_by?: string | null
          note?: string | null
          returned_at?: string | null
          returned_by?: string | null
          to_address?: string | null
          to_email?: string | null
          to_name: string
          to_phone?: string | null
        }
        Update: {
          anonymized_at?: string | null
          asset_id?: string
          bounce_reason?: string | null
          bounced_at?: string | null
          company_id?: string
          employee_id?: string | null
          expires_at?: string | null
          id?: string
          lent_at?: string
          lent_by?: string | null
          note?: string | null
          returned_at?: string | null
          returned_by?: string | null
          to_address?: string | null
          to_email?: string | null
          to_name?: string
          to_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_loans_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_loans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_loans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_locations: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          kind: string
          name: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_locations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_no_seq: {
        Row: {
          company_id: string
          last_value: number
        }
        Insert: {
          company_id: string
          last_value?: number
        }
        Update: {
          company_id?: string
          last_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "asset_no_seq_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          asset_tag: string
          assigned_at: string | null
          assigned_to_employee_id: string | null
          barcode: string | null
          category_id: string | null
          company_id: string
          condition: string | null
          created_at: string
          id: string
          is_active: boolean
          location_id: string | null
          name: string
          purchase_price: number | null
          purchased_at: string | null
          retired_at: string | null
          retired_reason: string | null
          serial_no: string | null
          service_expected_back: string | null
          service_vendor: string | null
          status: Database["public"]["Enums"]["asset_status"]
          warranty_until: string | null
          written_off_at: string | null
        }
        Insert: {
          asset_tag: string
          assigned_at?: string | null
          assigned_to_employee_id?: string | null
          barcode?: string | null
          category_id?: string | null
          company_id: string
          condition?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          name: string
          purchase_price?: number | null
          purchased_at?: string | null
          retired_at?: string | null
          retired_reason?: string | null
          serial_no?: string | null
          service_expected_back?: string | null
          service_vendor?: string | null
          status?: Database["public"]["Enums"]["asset_status"]
          warranty_until?: string | null
          written_off_at?: string | null
        }
        Update: {
          asset_tag?: string
          assigned_at?: string | null
          assigned_to_employee_id?: string | null
          barcode?: string | null
          category_id?: string | null
          company_id?: string
          condition?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          name?: string
          purchase_price?: number | null
          purchased_at?: string | null
          retired_at?: string | null
          retired_reason?: string | null
          serial_no?: string | null
          service_expected_back?: string | null
          service_vendor?: string | null
          status?: Database["public"]["Enums"]["asset_status"]
          warranty_until?: string | null
          written_off_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_assigned_to_employee_id_fkey"
            columns: ["assigned_to_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "asset_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "asset_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          category: string | null
          company_id: string | null
          created_at: string
          detail: Json
          entity_id: string | null
          entity_type: string
          id: number
          level: string | null
          summary: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          category?: string | null
          company_id?: string | null
          created_at?: string
          detail?: Json
          entity_id?: string | null
          entity_type: string
          id?: never
          level?: string | null
          summary?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          category?: string | null
          company_id?: string | null
          created_at?: string
          detail?: Json
          entity_id?: string | null
          entity_type?: string
          id?: never
          level?: string | null
          summary?: string | null
        }
        Relationships: []
      }
      booking_categories: {
        Row: {
          color_index: number | null
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          color_index?: number | null
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          color_index?: number | null
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_events: {
        Row: {
          actor_user_id: string | null
          booking_id: string
          company_id: string
          created_at: string
          detail: Json
          event_type: string
          id: number
        }
        Insert: {
          actor_user_id?: string | null
          booking_id: string
          company_id: string
          created_at?: string
          detail?: Json
          event_type: string
          id?: never
        }
        Update: {
          actor_user_id?: string | null
          booking_id?: string
          company_id?: string
          created_at?: string
          detail?: Json
          event_type?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "booking_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_notifications: {
        Row: {
          audience: Database["public"]["Enums"]["booking_notification_audience"]
          booking_id: string
          channel: Database["public"]["Enums"]["notification_channel"]
          company_id: string
          created_at: string
          error: string | null
          event_id: number | null
          id: string
          kind: Database["public"]["Enums"]["booking_notification_kind"]
          lang: string
          provider_id: string | null
          recipient: string | null
          status: Database["public"]["Enums"]["notification_status"]
        }
        Insert: {
          audience: Database["public"]["Enums"]["booking_notification_audience"]
          booking_id: string
          channel: Database["public"]["Enums"]["notification_channel"]
          company_id: string
          created_at?: string
          error?: string | null
          event_id?: number | null
          id?: string
          kind: Database["public"]["Enums"]["booking_notification_kind"]
          lang?: string
          provider_id?: string | null
          recipient?: string | null
          status: Database["public"]["Enums"]["notification_status"]
        }
        Update: {
          audience?: Database["public"]["Enums"]["booking_notification_audience"]
          booking_id?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          company_id?: string
          created_at?: string
          error?: string | null
          event_id?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["booking_notification_kind"]
          lang?: string
          provider_id?: string | null
          recipient?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "booking_notifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_participant_levels: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_participant_levels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_resources: {
        Row: {
          asset_id: string | null
          capacity: number | null
          category_id: string | null
          company_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          location: string | null
          name: string
          time_mode: string | null
        }
        Insert: {
          asset_id?: string | null
          capacity?: number | null
          category_id?: string | null
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          name: string
          time_mode?: string | null
        }
        Update: {
          asset_id?: string | null
          capacity?: number | null
          category_id?: string | null
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          name?: string
          time_mode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_resources_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_resources_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "booking_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_resources_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_service_lines: {
        Row: {
          booking_id: string
          company_id: string
          created_at: string
          id: string
          price_mode: string
          quantity: number
          service_id: string
          unit_price: number
        }
        Insert: {
          booking_id: string
          company_id: string
          created_at?: string
          id?: string
          price_mode: string
          quantity?: number
          service_id: string
          unit_price: number
        }
        Update: {
          booking_id?: string
          company_id?: string
          created_at?: string
          id?: string
          price_mode?: string
          quantity?: number
          service_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_service_lines_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_service_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_service_lines_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_services: {
        Row: {
          company_id: string
          created_at: string
          description: string | null
          has_quantity: boolean
          id: string
          is_active: boolean
          name: string
          price_mode: string
          unit_price: number
        }
        Insert: {
          company_id: string
          created_at?: string
          description?: string | null
          has_quantity?: boolean
          id?: string
          is_active?: boolean
          name: string
          price_mode?: string
          unit_price?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string | null
          has_quantity?: boolean
          id?: string
          is_active?: boolean
          name?: string
          price_mode?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_services_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_tariffs: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          level_id: string | null
          note: string | null
          resource_id: string | null
          scope: string
          service_id: string | null
          target_id: string | null
          unit: string
          valid_from: string
          valid_to: string | null
          vat_code: string | null
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          level_id?: string | null
          note?: string | null
          resource_id?: string | null
          scope: string
          service_id?: string | null
          unit: string
          valid_from?: string
          valid_to?: string | null
          vat_code?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          level_id?: string | null
          note?: string | null
          resource_id?: string | null
          scope?: string
          service_id?: string | null
          unit?: string
          valid_from?: string
          valid_to?: string | null
          vat_code?: string | null
        }
        Relationships: []
      }
      bookings: {
        Row: {
          all_day: boolean
          booked_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          created_at: string
          employee_id: string | null
          ends_at: string
          id: string
          invoiced_at: string | null
          invoiced_by: string | null
          participant_count: number | null
          participant_level_id: string | null
          resource_id: string
          starts_at: string
          status: Database["public"]["Enums"]["booking_status"]
          title: string | null
        }
        Insert: {
          all_day?: boolean
          booked_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          created_at?: string
          employee_id?: string | null
          ends_at: string
          id?: string
          invoiced_at?: string | null
          invoiced_by?: string | null
          participant_count?: number | null
          participant_level_id?: string | null
          resource_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["booking_status"]
          title?: string | null
        }
        Update: {
          all_day?: boolean
          booked_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          created_at?: string
          employee_id?: string | null
          ends_at?: string
          id?: string
          invoiced_at?: string | null
          invoiced_by?: string | null
          participant_count?: number | null
          participant_level_id?: string | null
          resource_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["booking_status"]
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_participant_level_id_fkey"
            columns: ["participant_level_id"]
            isOneToOne: false
            referencedRelation: "booking_participant_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "booking_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_agreements: {
        Row: {
          account_no: string | null
          agreement_type: string
          api_key: string | null
          api_user: string | null
          company_id: string | null
          created_at: string
          has_key: boolean | null
          id: string
          is_active: boolean
          name: string | null
          provider: string
          updated_at: string
        }
        Insert: {
          account_no?: string | null
          agreement_type: string
          api_key?: string | null
          api_user?: string | null
          company_id?: string | null
          created_at?: string
          has_key?: boolean | null
          id?: string
          is_active?: boolean
          name?: string | null
          provider: string
          updated_at?: string
        }
        Update: {
          account_no?: string | null
          agreement_type?: string
          api_key?: string | null
          api_user?: string | null
          company_id?: string | null
          created_at?: string
          has_key?: boolean | null
          id?: string
          is_active?: boolean
          name?: string | null
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_agreements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      carriers: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carriers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          asset_no_length: number | null
          asset_no_prefix: string
          asset_no_type: string
          asset_reminder_1_days: number | null
          asset_reminder_1_enabled: boolean | null
          asset_reminder_2_days: number | null
          asset_reminder_2_enabled: boolean | null
          asset_reminder_max: number | null
          booking_cancelled_enabled: boolean | null
          booking_copy_email: string | null
          booking_created_enabled: boolean | null
          booking_invoice_email: string | null
          booking_invoiced_enabled: boolean | null
          booking_notify_booker: boolean | null
          booking_reminder_enabled: boolean | null
          booking_reminder_hours: number | null
          booking_retro_allowed: boolean
          booking_time_mode: string
          booking_updated_enabled: boolean | null
          created_at: string
          default_currency: string
          default_language: string
          dpa_signed_at: string | null
          dpa_signed_by: string | null
          dpa_version: string | null
          handheld_reauth_minutes: number | null
          id: string
          is_active: boolean
          login_biometric_enabled: boolean | null
          login_password_enabled: boolean | null
          logo_url: string | null
          name: string
          notify_email_enabled: boolean | null
          notify_slack_enabled: boolean | null
          notify_sms_enabled: boolean | null
          notify_teams_enabled: boolean | null
          parcel_arrival_enabled: boolean | null
          parcel_reminder_1_days: number | null
          parcel_reminder_1_enabled: boolean | null
          parcel_reminder_2_days: number | null
          parcel_reminder_2_enabled: boolean | null
          parcel_reminder_max: number | null
          parcel_status_enabled: boolean | null
          parcel_status_time: string | null
          privacy_contact_email: string | null
          privacy_contact_name: string | null
          privacy_contact_phone: string | null
          purchasing_email: string | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          registration_no: string | null
          security_contact_email: string | null
          security_contact_name: string | null
          security_contact_phone: string | null
          shipping_byoc_fee: number | null
          shipping_byoc_subscription: number | null
          shipping_margin_fixed: number | null
          shipping_margin_percent: number | null
          shipping_model: string | null
          slack_lookup_by_email: boolean
          supported_currencies: string[]
          supported_languages: string[]
          timezone: string
          updated_at: string
        }
        Insert: {
          asset_no_length?: number | null
          asset_no_prefix?: string
          asset_no_type?: string
          asset_reminder_1_days?: number | null
          asset_reminder_1_enabled?: boolean | null
          asset_reminder_2_days?: number | null
          asset_reminder_2_enabled?: boolean | null
          asset_reminder_max?: number | null
          booking_cancelled_enabled?: boolean | null
          booking_copy_email?: string | null
          booking_created_enabled?: boolean | null
          booking_invoice_email?: string | null
          booking_invoiced_enabled?: boolean | null
          booking_notify_booker?: boolean | null
          booking_reminder_enabled?: boolean | null
          booking_reminder_hours?: number | null
          booking_retro_allowed?: boolean
          booking_time_mode?: string
          booking_updated_enabled?: boolean | null
          created_at?: string
          default_currency?: string
          default_language?: string
          dpa_signed_at?: string | null
          dpa_signed_by?: string | null
          dpa_version?: string | null
          handheld_reauth_minutes?: number | null
          id?: string
          is_active?: boolean
          login_biometric_enabled?: boolean | null
          login_password_enabled?: boolean | null
          logo_url?: string | null
          name: string
          notify_email_enabled?: boolean | null
          notify_slack_enabled?: boolean | null
          notify_sms_enabled?: boolean | null
          notify_teams_enabled?: boolean | null
          parcel_arrival_enabled?: boolean | null
          parcel_reminder_1_days?: number | null
          parcel_reminder_1_enabled?: boolean | null
          parcel_reminder_2_days?: number | null
          parcel_reminder_2_enabled?: boolean | null
          parcel_reminder_max?: number | null
          parcel_status_enabled?: boolean | null
          parcel_status_time?: string | null
          privacy_contact_email?: string | null
          privacy_contact_name?: string | null
          privacy_contact_phone?: string | null
          purchasing_email?: string | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          registration_no?: string | null
          security_contact_email?: string | null
          security_contact_name?: string | null
          security_contact_phone?: string | null
          shipping_byoc_fee?: number | null
          shipping_byoc_subscription?: number | null
          shipping_margin_fixed?: number | null
          shipping_margin_percent?: number | null
          shipping_model?: string | null
          slack_lookup_by_email?: boolean
          supported_currencies?: string[]
          supported_languages?: string[]
          timezone?: string
          updated_at?: string
        }
        Update: {
          asset_no_length?: number | null
          asset_no_prefix?: string
          asset_no_type?: string
          asset_reminder_1_days?: number | null
          asset_reminder_1_enabled?: boolean | null
          asset_reminder_2_days?: number | null
          asset_reminder_2_enabled?: boolean | null
          asset_reminder_max?: number | null
          booking_cancelled_enabled?: boolean | null
          booking_copy_email?: string | null
          booking_created_enabled?: boolean | null
          booking_invoice_email?: string | null
          booking_invoiced_enabled?: boolean | null
          booking_notify_booker?: boolean | null
          booking_reminder_enabled?: boolean | null
          booking_reminder_hours?: number | null
          booking_retro_allowed?: boolean
          booking_time_mode?: string
          booking_updated_enabled?: boolean | null
          created_at?: string
          default_currency?: string
          default_language?: string
          dpa_signed_at?: string | null
          dpa_signed_by?: string | null
          dpa_version?: string | null
          handheld_reauth_minutes?: number | null
          id?: string
          is_active?: boolean
          login_biometric_enabled?: boolean | null
          login_password_enabled?: boolean | null
          logo_url?: string | null
          name?: string
          notify_email_enabled?: boolean | null
          notify_slack_enabled?: boolean | null
          notify_sms_enabled?: boolean | null
          notify_teams_enabled?: boolean | null
          parcel_arrival_enabled?: boolean | null
          parcel_reminder_1_days?: number | null
          parcel_reminder_1_enabled?: boolean | null
          parcel_reminder_2_days?: number | null
          parcel_reminder_2_enabled?: boolean | null
          parcel_reminder_max?: number | null
          parcel_status_enabled?: boolean | null
          parcel_status_time?: string | null
          privacy_contact_email?: string | null
          privacy_contact_name?: string | null
          privacy_contact_phone?: string | null
          purchasing_email?: string | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          registration_no?: string | null
          security_contact_email?: string | null
          security_contact_name?: string | null
          security_contact_phone?: string | null
          shipping_byoc_fee?: number | null
          shipping_byoc_subscription?: number | null
          shipping_margin_fixed?: number | null
          shipping_margin_percent?: number | null
          shipping_model?: string | null
          slack_lookup_by_email?: boolean
          supported_currencies?: string[]
          supported_languages?: string[]
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_accounting_config: {
        Row: {
          agreement_company_name: string | null
          agreement_number: number | null
          company_id: string
          created_at: string
          enabled: boolean
          provider: string
          token_set: boolean
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          agreement_company_name?: string | null
          agreement_number?: number | null
          company_id: string
          created_at?: string
          enabled?: boolean
          provider?: string
          token_set?: boolean
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          agreement_company_name?: string | null
          agreement_number?: number | null
          company_id?: string
          created_at?: string
          enabled?: boolean
          provider?: string
          token_set?: boolean
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_accounting_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_accounting_secret: {
        Row: {
          access_token: string | null
          company_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          company_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          company_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_accounting_secret_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_ai_config: {
        Row: {
          company_id: string
          created_at: string
          disclosure_accepted: boolean
          disclosure_accepted_at: string | null
          disclosure_accepted_by: string | null
          disclosure_provider: string | null
          disclosure_version: string | null
          match_enabled: boolean
          model: string | null
          provider: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          disclosure_accepted?: boolean
          disclosure_accepted_at?: string | null
          disclosure_accepted_by?: string | null
          disclosure_provider?: string | null
          disclosure_version?: string | null
          match_enabled?: boolean
          model?: string | null
          provider?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          disclosure_accepted?: boolean
          disclosure_accepted_at?: string | null
          disclosure_accepted_by?: string | null
          disclosure_provider?: string | null
          disclosure_version?: string | null
          match_enabled?: boolean
          model?: string | null
          provider?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_ai_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_data_transfer: {
        Row: {
          company_id: string
          created_at: string
          email_enabled: boolean
          import_schedule_enabled: boolean
          import_schedule_time: string | null
          sftp_enabled: boolean
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email_enabled?: boolean
          import_schedule_enabled?: boolean
          import_schedule_time?: string | null
          sftp_enabled?: boolean
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email_enabled?: boolean
          import_schedule_enabled?: boolean
          import_schedule_time?: string | null
          sftp_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_data_transfer_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_data_transfer_secret: {
        Row: {
          company_id: string
          created_at: string
          email_allowed_senders: string[]
          email_name: string | null
          sftp_password: string | null
          sftp_password_set: boolean | null
          sftp_username: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email_allowed_senders?: string[]
          email_name?: string | null
          sftp_password?: string | null
          sftp_password_set?: boolean | null
          sftp_username?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email_allowed_senders?: string[]
          email_name?: string | null
          sftp_password?: string | null
          sftp_password_set?: boolean | null
          sftp_username?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_data_transfer_secret_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_entra_config: {
        Row: {
          anonymize_retired: boolean | null
          client_id: string | null
          client_secret_set: boolean
          company_id: string
          created_at: string
          dry_run_at: string | null
          enabled: boolean
          first_sync_at: string | null
          group_id: string | null
          group_name: string | null
          initials_source: string | null
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          sync_interval_minutes: number | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          anonymize_retired?: boolean | null
          client_id?: string | null
          client_secret_set?: boolean
          company_id: string
          created_at?: string
          dry_run_at?: string | null
          enabled?: boolean
          first_sync_at?: string | null
          group_id?: string | null
          group_name?: string | null
          initials_source?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          sync_interval_minutes?: number | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          anonymize_retired?: boolean | null
          client_id?: string | null
          client_secret_set?: boolean
          company_id?: string
          created_at?: string
          dry_run_at?: string | null
          enabled?: boolean
          first_sync_at?: string | null
          group_id?: string | null
          group_name?: string | null
          initials_source?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          sync_interval_minutes?: number | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_entra_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_entra_secret: {
        Row: {
          client_secret: string | null
          company_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          client_secret?: string | null
          company_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          client_secret?: string | null
          company_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_entra_secret_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_features: {
        Row: {
          company_id: string
          created_at: string
          feature_key: string
          valid_until: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          feature_key: string
          valid_until?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          feature_key?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_features_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_features_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "feature_catalog"
            referencedColumns: ["key"]
          },
        ]
      }
      company_handheld_config: {
        Row: {
          company_id: string
          created_at: string
          handheld_design: Json
          handheld_tiles: Json
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          handheld_design?: Json
          handheld_tiles?: Json
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          handheld_design?: Json
          handheld_tiles?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_handheld_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_home_config: {
        Row: {
          company_id: string
          created_at: string
          home_design: Json
          home_tiles: Json
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          home_design?: Json
          home_tiles?: Json
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          home_design?: Json
          home_tiles?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_home_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_products: {
        Row: {
          company_id: string
          created_at: string
          product_key: string
          valid_until: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          product_key: string
          valid_until?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          product_key?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_products_product_key_fkey"
            columns: ["product_key"]
            isOneToOne: false
            referencedRelation: "product_catalog"
            referencedColumns: ["key"]
          },
        ]
      }
      company_retention: {
        Row: {
          asset_loans_days: number | null
          audit_days: number | null
          bookings_days: number | null
          company_id: string
          employees_days: number | null
          imports_days: number | null
          notifications_days: number | null
          parcel_files_days: number | null
          parcels_days: number | null
          routes_days: number | null
          updated_at: string
        }
        Insert: {
          asset_loans_days?: number | null
          audit_days?: number | null
          bookings_days?: number | null
          company_id: string
          employees_days?: number | null
          imports_days?: number | null
          notifications_days?: number | null
          parcel_files_days?: number | null
          parcels_days?: number | null
          routes_days?: number | null
          updated_at?: string
        }
        Update: {
          asset_loans_days?: number | null
          audit_days?: number | null
          bookings_days?: number | null
          company_id?: string
          employees_days?: number | null
          imports_days?: number | null
          notifications_days?: number | null
          parcel_files_days?: number | null
          parcels_days?: number | null
          routes_days?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_retention_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_slack_config: {
        Row: {
          bot_user_id: string | null
          company_id: string
          connected_at: string | null
          connected_by: string | null
          created_at: string
          team_id: string | null
          team_name: string | null
          token_set: boolean
          updated_at: string
        }
        Insert: {
          bot_user_id?: string | null
          company_id: string
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          team_id?: string | null
          team_name?: string | null
          token_set?: boolean
          updated_at?: string
        }
        Update: {
          bot_user_id?: string | null
          company_id?: string
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          team_id?: string | null
          team_name?: string | null
          token_set?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_slack_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_slack_secret: {
        Row: {
          bot_token: string | null
          company_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          bot_token?: string | null
          company_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          bot_token?: string | null
          company_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_slack_secret_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_templates: {
        Row: {
          body: string
          company_id: string
          key: string
          kind: string
          lang: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          company_id: string
          key: string
          kind?: string
          lang?: string
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          company_id?: string
          key?: string
          kind?: string
          lang?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          company_id: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          anonymized_at: string | null
          company_id: string
          created_at: string
          department_id: string | null
          email: string | null
          employee_no: string | null
          external_id: string | null
          first_name: string | null
          full_name: string
          full_name_folded: string | null
          id: string
          initials: string | null
          initials_folded: string | null
          is_active: boolean
          is_manual: boolean
          language: string
          last_name: string | null
          nfc_card_id: string | null
          phone: string | null
          retired_at: string | null
          role: string | null
          slack_user_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          anonymized_at?: string | null
          company_id: string
          created_at?: string
          department_id?: string | null
          email?: string | null
          employee_no?: string | null
          external_id?: string | null
          first_name?: string | null
          full_name: string
          full_name_folded?: string | null
          id?: string
          initials?: string | null
          initials_folded?: string | null
          is_active?: boolean
          is_manual?: boolean
          language?: string
          last_name?: string | null
          nfc_card_id?: string | null
          phone?: string | null
          retired_at?: string | null
          role?: string | null
          slack_user_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          anonymized_at?: string | null
          company_id?: string
          created_at?: string
          department_id?: string | null
          email?: string | null
          employee_no?: string | null
          external_id?: string | null
          first_name?: string | null
          full_name?: string
          full_name_folded?: string | null
          id?: string
          initials?: string | null
          initials_folded?: string | null
          is_active?: boolean
          is_manual?: boolean
          language?: string
          last_name?: string | null
          nfc_card_id?: string | null
          phone?: string | null
          retired_at?: string | null
          role?: string | null
          slack_user_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_catalog: {
        Row: {
          description: string | null
          description_en: string | null
          enabled: boolean
          key: string
          name: string
          name_en: string | null
          product_key: string
        }
        Insert: {
          description?: string | null
          description_en?: string | null
          enabled?: boolean
          key: string
          name: string
          name_en?: string | null
          product_key: string
        }
        Update: {
          description?: string | null
          description_en?: string | null
          enabled?: boolean
          key?: string
          name?: string
          name_en?: string | null
          product_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_catalog_product_key_fkey"
            columns: ["product_key"]
            isOneToOne: false
            referencedRelation: "product_catalog"
            referencedColumns: ["key"]
          },
        ]
      }
      feedback: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          kind: string
          message: string
          page_path: string | null
          screenshot_path: string | null
          subject: string | null
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          kind: string
          message: string
          page_path?: string | null
          screenshot_path?: string | null
          subject?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          message?: string
          page_path?: string | null
          screenshot_path?: string | null
          subject?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      handheld_deploys: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          log: string | null
          requested_by: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          log?: string | null
          requested_by?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          log?: string | null
          requested_by?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      handling_classes: {
        Row: {
          allow_leave_at_location: boolean
          allow_proxy_collection: boolean
          company_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          allow_leave_at_location?: boolean
          allow_proxy_collection?: boolean
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          allow_leave_at_location?: boolean
          allow_proxy_collection?: boolean
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "handling_classes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      import_configs: {
        Row: {
          company_id: string
          fields: string[]
          has_footer: boolean
          has_header: boolean
          import_type: string
          separator: string
          updated_at: string
        }
        Insert: {
          company_id: string
          fields?: string[]
          has_footer?: boolean
          has_header?: boolean
          import_type?: string
          separator?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          fields?: string[]
          has_footer?: boolean
          has_header?: boolean
          import_type?: string
          separator?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_configs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      import_locks: {
        Row: {
          company_id: string
          locked_at: string
        }
        Insert: {
          company_id: string
          locked_at?: string
        }
        Update: {
          company_id?: string
          locked_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_locks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      import_runs: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          created_by_email: string | null
          created_count: number
          deactivated_count: number
          departments_created: number
          errors: Json
          file_name: string | null
          id: string
          kind: string
          rejected_count: number
          rows_total: number
          skipped_manual_count: number
          status: string
          unchanged_count: number
          updated_count: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          created_count?: number
          deactivated_count?: number
          departments_created?: number
          errors?: Json
          file_name?: string | null
          id?: string
          kind?: string
          rejected_count?: number
          rows_total?: number
          skipped_manual_count?: number
          status: string
          unchanged_count?: number
          updated_count?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          created_count?: number
          deactivated_count?: number
          departments_created?: number
          errors?: Json
          file_name?: string | null
          id?: string
          kind?: string
          rejected_count?: number
          rows_total?: number
          skipped_manual_count?: number
          status?: string
          unchanged_count?: number
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_files: {
        Row: {
          company_id: string
          file_name: string | null
          file_size: number | null
          id: string
          import_run_id: string | null
          message_id: string | null
          object_path: string
          received_at: string
          source: string
          status: string
        }
        Insert: {
          company_id: string
          file_name?: string | null
          file_size?: number | null
          id?: string
          import_run_id?: string | null
          message_id?: string | null
          object_path: string
          received_at?: string
          source: string
          status?: string
        }
        Update: {
          company_id?: string
          file_name?: string | null
          file_size?: number | null
          id?: string
          import_run_id?: string | null
          message_id?: string | null
          object_path?: string
          received_at?: string
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_files_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_files_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          category_id: string | null
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          location_id: string | null
          name: string
          on_order: number
          quantity: number
          reorder_point: number | null
          sku: string | null
          unit: string | null
          unit_cost: number | null
        }
        Insert: {
          category_id?: string | null
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          name: string
          on_order?: number
          quantity?: number
          reorder_point?: number | null
          sku?: string | null
          unit?: string | null
          unit_cost?: number | null
        }
        Update: {
          category_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          name?: string
          on_order?: number
          quantity?: number
          reorder_point?: number | null
          sku?: string | null
          unit?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "asset_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "asset_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      lockers: {
        Row: {
          cap_large: number
          cap_medium: number
          cap_small: number
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          keynius_bank_id: string | null
          name: string
          storage_location_id: string | null
          updated_at: string
        }
        Insert: {
          cap_large?: number
          cap_medium?: number
          cap_small?: number
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          keynius_bank_id?: string | null
          name: string
          storage_location_id?: string | null
          updated_at?: string
        }
        Update: {
          cap_large?: number
          cap_medium?: number
          cap_small?: number
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          keynius_bank_id?: string | null
          name?: string
          storage_location_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lockers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lockers_storage_location_id_fkey"
            columns: ["storage_location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      log_drains: {
        Row: {
          company_id: string | null
          config: Json
          created_at: string
          destination: string
          enabled: boolean
          endpoint: string | null
          id: string
          last_delivered_id: number
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          name: string
          secret: string | null
          secret_set: boolean
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          config?: Json
          created_at?: string
          destination?: string
          enabled?: boolean
          endpoint?: string | null
          id?: string
          last_delivered_id?: number
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          name: string
          secret?: string | null
          secret_set?: boolean
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          config?: Json
          created_at?: string
          destination?: string
          enabled?: boolean
          endpoint?: string | null
          id?: string
          last_delivered_id?: number
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          name?: string
          secret?: string | null
          secret_set?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "log_drains_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      parcel_barcode_seq: {
        Row: {
          company_id: string
          last_value: number
        }
        Insert: {
          company_id: string
          last_value?: number
        }
        Update: {
          company_id?: string
          last_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "parcel_barcode_seq_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      parcel_batches: {
        Row: {
          batch_code: string | null
          company_id: string
          created_at: string
          created_by: string | null
          department_id: string | null
          finished_at: string | null
          id: string
          receiver_employee_id: string
          status: Database["public"]["Enums"]["batch_status"]
          updated_at: string
        }
        Insert: {
          batch_code?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          finished_at?: string | null
          id?: string
          receiver_employee_id: string
          status?: Database["public"]["Enums"]["batch_status"]
          updated_at?: string
        }
        Update: {
          batch_code?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          finished_at?: string | null
          id?: string
          receiver_employee_id?: string
          status?: Database["public"]["Enums"]["batch_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parcel_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcel_batches_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcel_batches_receiver_employee_id_fkey"
            columns: ["receiver_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      parcel_documents: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          parcel_id: string
          storage_path: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          parcel_id: string
          storage_path: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          parcel_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "parcel_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcel_documents_parcel_id_fkey"
            columns: ["parcel_id"]
            isOneToOne: false
            referencedRelation: "parcels"
            referencedColumns: ["id"]
          },
        ]
      }
      parcel_events: {
        Row: {
          actor_user_id: string | null
          company_id: string
          created_at: string
          detail: Json
          event_type: string
          from_location_id: string | null
          from_status: Database["public"]["Enums"]["parcel_status"] | null
          id: number
          parcel_id: string
          to_location_id: string | null
          to_status: Database["public"]["Enums"]["parcel_status"] | null
        }
        Insert: {
          actor_user_id?: string | null
          company_id: string
          created_at?: string
          detail?: Json
          event_type: string
          from_location_id?: string | null
          from_status?: Database["public"]["Enums"]["parcel_status"] | null
          id?: never
          parcel_id: string
          to_location_id?: string | null
          to_status?: Database["public"]["Enums"]["parcel_status"] | null
        }
        Update: {
          actor_user_id?: string | null
          company_id?: string
          created_at?: string
          detail?: Json
          event_type?: string
          from_location_id?: string | null
          from_status?: Database["public"]["Enums"]["parcel_status"] | null
          id?: never
          parcel_id?: string
          to_location_id?: string | null
          to_status?: Database["public"]["Enums"]["parcel_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "parcel_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcel_events_parcel_id_fkey"
            columns: ["parcel_id"]
            isOneToOne: false
            referencedRelation: "parcels"
            referencedColumns: ["id"]
          },
        ]
      }
      parcel_notifications: {
        Row: {
          batch_id: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          company_id: string
          created_at: string
          digest_key: string | null
          employee_id: string | null
          error: string | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          lang: string
          parcel_id: string
          provider_id: string | null
          recipient: string | null
          status: Database["public"]["Enums"]["notification_status"]
        }
        Insert: {
          batch_id?: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          company_id: string
          created_at?: string
          digest_key?: string | null
          employee_id?: string | null
          error?: string | null
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          lang?: string
          parcel_id: string
          provider_id?: string | null
          recipient?: string | null
          status: Database["public"]["Enums"]["notification_status"]
        }
        Update: {
          batch_id?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          company_id?: string
          created_at?: string
          digest_key?: string | null
          employee_id?: string | null
          error?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          lang?: string
          parcel_id?: string
          provider_id?: string | null
          recipient?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "parcel_notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcel_notifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcel_notifications_parcel_id_fkey"
            columns: ["parcel_id"]
            isOneToOne: false
            referencedRelation: "parcels"
            referencedColumns: ["id"]
          },
        ]
      }
      parcels: {
        Row: {
          barcode: string | null
          batch_id: string | null
          carrier_id: string | null
          client_key: string | null
          company_id: string
          condition_note: string | null
          condition_photo_path: string | null
          condition_preset: string | null
          created_at: string
          delivered_at: string | null
          delivered_employee_id: string | null
          delivered_note: string | null
          delivered_signature_path: string | null
          delivered_to: string | null
          department_id: string | null
          handling_class_id: string | null
          id: string
          is_private: boolean
          parcel_type: Database["public"]["Enums"]["parcel_type"]
          receiver_employee_id: string | null
          receiver_override_at: string | null
          receiver_override_by: string | null
          receiver_override_reason: string | null
          registered_at: string
          registered_by: string | null
          removed_at: string | null
          removed_by: string | null
          removed_reason: string | null
          sender: string | null
          status: Database["public"]["Enums"]["parcel_status"]
          storage_location_id: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          batch_id?: string | null
          carrier_id?: string | null
          client_key?: string | null
          company_id: string
          condition_note?: string | null
          condition_photo_path?: string | null
          condition_preset?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_employee_id?: string | null
          delivered_note?: string | null
          delivered_signature_path?: string | null
          delivered_to?: string | null
          department_id?: string | null
          handling_class_id?: string | null
          id?: string
          is_private?: boolean
          parcel_type?: Database["public"]["Enums"]["parcel_type"]
          receiver_employee_id?: string | null
          receiver_override_at?: string | null
          receiver_override_by?: string | null
          receiver_override_reason?: string | null
          registered_at?: string
          registered_by?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          sender?: string | null
          status?: Database["public"]["Enums"]["parcel_status"]
          storage_location_id?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          batch_id?: string | null
          carrier_id?: string | null
          client_key?: string | null
          company_id?: string
          condition_note?: string | null
          condition_photo_path?: string | null
          condition_preset?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_employee_id?: string | null
          delivered_note?: string | null
          delivered_signature_path?: string | null
          delivered_to?: string | null
          department_id?: string | null
          handling_class_id?: string | null
          id?: string
          is_private?: boolean
          parcel_type?: Database["public"]["Enums"]["parcel_type"]
          receiver_employee_id?: string | null
          receiver_override_at?: string | null
          receiver_override_by?: string | null
          receiver_override_reason?: string | null
          registered_at?: string
          registered_by?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          sender?: string | null
          status?: Database["public"]["Enums"]["parcel_status"]
          storage_location_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parcels_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "parcel_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcels_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcels_delivered_employee_id_fkey"
            columns: ["delivered_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcels_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcels_handling_class_id_fkey"
            columns: ["handling_class_id"]
            isOneToOne: false
            referencedRelation: "handling_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcels_receiver_employee_id_fkey"
            columns: ["receiver_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcels_storage_location_id_fkey"
            columns: ["storage_location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_asset_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          track: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          track?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          track?: string
        }
        Relationships: []
      }
      platform_secrets: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          updated_by: string | null
          value: string | null
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          accounting_enabled: boolean
          accounting_providers: string[]
          ahasend_account_id: string | null
          ahasend_api_key_set: boolean
          ai_enabled: boolean
          ai_model_costs: Json
          ai_models: string[]
          ai_providers: string[]
          asset_loans_retention_days: number | null
          asset_no_length: number | null
          asset_no_prefix: string
          asset_no_type: string
          asset_notifications_enabled: boolean
          asset_reminder_1_days: number
          asset_reminder_1_enabled: boolean
          asset_reminder_2_days: number
          asset_reminder_2_enabled: boolean
          asset_reminder_max: number
          audit_retention_days: number | null
          booking_cancelled_enabled: boolean
          booking_created_enabled: boolean
          booking_invoiced_enabled: boolean
          booking_notifications_enabled: boolean
          booking_notify_booker: boolean
          booking_reminder_enabled: boolean
          booking_reminder_hours: number
          booking_retro_allowed: boolean
          booking_time_mode: string
          booking_updated_enabled: boolean
          bookings_retention_days: number | null
          brevo_api_key_set: boolean
          cost_per_email: number
          cost_per_sms: number
          default_currency: string
          default_language: string
          economic_app_secret_set: boolean
          email_allowlist_required: boolean
          email_antispoof_enabled: boolean
          email_antispoof_strict: boolean
          email_base_domain: string | null
          email_enabled: boolean
          email_from: string | null
          email_inbound_provider: string
          email_provider: string
          employees_retention_days: number | null
          entra_anonymize_retired: boolean
          entra_enabled: boolean
          entra_sync_interval_minutes: number
          google_maps_browser_key: string | null
          handheld_design: Json
          handheld_reauth_minutes: number
          handheld_tiles: Json
          home_design: Json
          home_tiles: Json
          id: boolean
          import_retention_days: number | null
          import_schedule_enabled: boolean
          import_schedule_time: string | null
          locker_loan_ttl_hours: number | null
          login_biometric_enabled: boolean
          login_password_enabled: boolean
          maps_provider: string
          notifications_retention_days: number | null
          notify_email_enabled: boolean
          notify_slack_enabled: boolean
          notify_sms_enabled: boolean
          notify_teams_enabled: boolean
          parcel_arrival_enabled: boolean
          parcel_files_retention_days: number | null
          parcel_notifications_enabled: boolean
          parcel_reminder_1_days: number
          parcel_reminder_1_enabled: boolean
          parcel_reminder_2_days: number
          parcel_reminder_2_enabled: boolean
          parcel_reminder_max: number
          parcel_status_enabled: boolean
          parcel_status_time: string
          parcels_retention_days: number | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          refresh_interval_seconds: number
          routes_retention_days: number | null
          sftp_enabled: boolean
          sftp_host: string | null
          shipping_byoc_fee: number
          shipping_byoc_subscription: number
          shipping_margin_fixed: number
          shipping_margin_percent: number
          shipping_model: string
          slack_enabled: boolean
          supported_currencies: string[]
          supported_languages: string[]
          updated_at: string
        }
        Insert: {
          accounting_enabled?: boolean
          accounting_providers?: string[]
          ahasend_account_id?: string | null
          ahasend_api_key_set?: boolean
          ai_enabled?: boolean
          ai_model_costs?: Json
          ai_models?: string[]
          ai_providers?: string[]
          asset_loans_retention_days?: number | null
          asset_no_length?: number | null
          asset_no_prefix?: string
          asset_no_type?: string
          asset_notifications_enabled?: boolean
          asset_reminder_1_days?: number
          asset_reminder_1_enabled?: boolean
          asset_reminder_2_days?: number
          asset_reminder_2_enabled?: boolean
          asset_reminder_max?: number
          audit_retention_days?: number | null
          booking_cancelled_enabled?: boolean
          booking_created_enabled?: boolean
          booking_invoiced_enabled?: boolean
          booking_notifications_enabled?: boolean
          booking_notify_booker?: boolean
          booking_reminder_enabled?: boolean
          booking_reminder_hours?: number
          booking_retro_allowed?: boolean
          booking_time_mode?: string
          booking_updated_enabled?: boolean
          bookings_retention_days?: number | null
          brevo_api_key_set?: boolean
          cost_per_email?: number
          cost_per_sms?: number
          default_currency?: string
          default_language?: string
          economic_app_secret_set?: boolean
          email_allowlist_required?: boolean
          email_antispoof_enabled?: boolean
          email_antispoof_strict?: boolean
          email_base_domain?: string | null
          email_enabled?: boolean
          email_from?: string | null
          email_inbound_provider?: string
          email_provider?: string
          employees_retention_days?: number | null
          entra_anonymize_retired?: boolean
          entra_enabled?: boolean
          entra_sync_interval_minutes?: number
          google_maps_browser_key?: string | null
          handheld_design?: Json
          handheld_reauth_minutes?: number
          handheld_tiles?: Json
          home_design?: Json
          home_tiles?: Json
          id?: boolean
          import_retention_days?: number | null
          import_schedule_enabled?: boolean
          import_schedule_time?: string | null
          locker_loan_ttl_hours?: number | null
          login_biometric_enabled?: boolean
          login_password_enabled?: boolean
          maps_provider?: string
          notifications_retention_days?: number | null
          notify_email_enabled?: boolean
          notify_slack_enabled?: boolean
          notify_sms_enabled?: boolean
          notify_teams_enabled?: boolean
          parcel_arrival_enabled?: boolean
          parcel_files_retention_days?: number | null
          parcel_notifications_enabled?: boolean
          parcel_reminder_1_days?: number
          parcel_reminder_1_enabled?: boolean
          parcel_reminder_2_days?: number
          parcel_reminder_2_enabled?: boolean
          parcel_reminder_max?: number
          parcel_status_enabled?: boolean
          parcel_status_time?: string
          parcels_retention_days?: number | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          refresh_interval_seconds?: number
          routes_retention_days?: number | null
          sftp_enabled?: boolean
          sftp_host?: string | null
          shipping_byoc_fee?: number
          shipping_byoc_subscription?: number
          shipping_margin_fixed?: number
          shipping_margin_percent?: number
          shipping_model?: string
          slack_enabled?: boolean
          supported_currencies?: string[]
          supported_languages?: string[]
          updated_at?: string
        }
        Update: {
          accounting_enabled?: boolean
          accounting_providers?: string[]
          ahasend_account_id?: string | null
          ahasend_api_key_set?: boolean
          ai_enabled?: boolean
          ai_model_costs?: Json
          ai_models?: string[]
          ai_providers?: string[]
          asset_loans_retention_days?: number | null
          asset_no_length?: number | null
          asset_no_prefix?: string
          asset_no_type?: string
          asset_notifications_enabled?: boolean
          asset_reminder_1_days?: number
          asset_reminder_1_enabled?: boolean
          asset_reminder_2_days?: number
          asset_reminder_2_enabled?: boolean
          asset_reminder_max?: number
          audit_retention_days?: number | null
          booking_cancelled_enabled?: boolean
          booking_created_enabled?: boolean
          booking_invoiced_enabled?: boolean
          booking_notifications_enabled?: boolean
          booking_notify_booker?: boolean
          booking_reminder_enabled?: boolean
          booking_reminder_hours?: number
          booking_retro_allowed?: boolean
          booking_time_mode?: string
          booking_updated_enabled?: boolean
          bookings_retention_days?: number | null
          brevo_api_key_set?: boolean
          cost_per_email?: number
          cost_per_sms?: number
          default_currency?: string
          default_language?: string
          economic_app_secret_set?: boolean
          email_allowlist_required?: boolean
          email_antispoof_enabled?: boolean
          email_antispoof_strict?: boolean
          email_base_domain?: string | null
          email_enabled?: boolean
          email_from?: string | null
          email_inbound_provider?: string
          email_provider?: string
          employees_retention_days?: number | null
          entra_anonymize_retired?: boolean
          entra_enabled?: boolean
          entra_sync_interval_minutes?: number
          google_maps_browser_key?: string | null
          handheld_design?: Json
          handheld_reauth_minutes?: number
          handheld_tiles?: Json
          home_design?: Json
          home_tiles?: Json
          id?: boolean
          import_retention_days?: number | null
          import_schedule_enabled?: boolean
          import_schedule_time?: string | null
          locker_loan_ttl_hours?: number | null
          login_biometric_enabled?: boolean
          login_password_enabled?: boolean
          maps_provider?: string
          notifications_retention_days?: number | null
          notify_email_enabled?: boolean
          notify_slack_enabled?: boolean
          notify_sms_enabled?: boolean
          notify_teams_enabled?: boolean
          parcel_arrival_enabled?: boolean
          parcel_files_retention_days?: number | null
          parcel_notifications_enabled?: boolean
          parcel_reminder_1_days?: number
          parcel_reminder_1_enabled?: boolean
          parcel_reminder_2_days?: number
          parcel_reminder_2_enabled?: boolean
          parcel_reminder_max?: number
          parcel_status_enabled?: boolean
          parcel_status_time?: string
          parcels_retention_days?: number | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          refresh_interval_seconds?: number
          routes_retention_days?: number | null
          sftp_enabled?: boolean
          sftp_host?: string | null
          shipping_byoc_fee?: number
          shipping_byoc_subscription?: number
          shipping_margin_fixed?: number
          shipping_margin_percent?: number
          shipping_model?: string
          slack_enabled?: boolean
          supported_currencies?: string[]
          supported_languages?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      platform_templates: {
        Row: {
          body: string
          company_editable: boolean
          key: string
          kind: string
          lang: string
          name: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          company_editable?: boolean
          key: string
          kind?: string
          lang?: string
          name: string
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          company_editable?: boolean
          key?: string
          kind?: string
          lang?: string
          name?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_appearance: {
        Row: {
          company_id: string
          created_at: string
          header_color: string | null
          header_name: string | null
          id: string
          logo_url: string | null
          product_key: string
          theme: string | null
          updated_at: string
          watermark_url: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          header_color?: string | null
          header_name?: string | null
          id?: string
          logo_url?: string | null
          product_key: string
          theme?: string | null
          updated_at?: string
          watermark_url?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          header_color?: string | null
          header_name?: string | null
          id?: string
          logo_url?: string | null
          product_key?: string
          theme?: string | null
          updated_at?: string
          watermark_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_appearance_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_appearance_product_key_fkey"
            columns: ["product_key"]
            isOneToOne: false
            referencedRelation: "product_catalog"
            referencedColumns: ["key"]
          },
        ]
      }
      product_catalog: {
        Row: {
          description: string | null
          description_en: string | null
          enabled: boolean
          key: string
          name: string
          name_en: string | null
          sort_order: number
        }
        Insert: {
          description?: string | null
          description_en?: string | null
          enabled?: boolean
          key: string
          name: string
          name_en?: string | null
          sort_order?: number
        }
        Update: {
          description?: string | null
          description_en?: string | null
          enabled?: boolean
          key?: string
          name?: string
          name_en?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      routes: {
        Row: {
          company_id: string
          created_at: string
          description: string | null
          distance_m: number | null
          drivers: Json
          duration_s: number | null
          from_address: string | null
          from_lat: number | null
          from_lng: number | null
          geometry: Json | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          num_cars: number
          optimize_stops: boolean
          round_trip: boolean
          stops: Json
          to_address: string | null
          to_lat: number | null
          to_lng: number | null
          transport_type: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          description?: string | null
          distance_m?: number | null
          drivers?: Json
          duration_s?: number | null
          from_address?: string | null
          from_lat?: number | null
          from_lng?: number | null
          geometry?: Json | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          num_cars?: number
          optimize_stops?: boolean
          round_trip?: boolean
          stops?: Json
          to_address?: string | null
          to_lat?: number | null
          to_lng?: number | null
          transport_type?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string | null
          distance_m?: number | null
          drivers?: Json
          duration_s?: number | null
          from_address?: string | null
          from_lat?: number | null
          from_lng?: number | null
          geometry?: Json | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          num_cars?: number
          optimize_stops?: boolean
          round_trip?: boolean
          stops?: Json
          to_address?: string | null
          to_lat?: number | null
          to_lng?: number | null
          transport_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_leads: {
        Row: {
          company: string | null
          created_at: string
          email: string
          email_error: string | null
          email_sent: boolean
          id: string
          ip: unknown
          name: string | null
          params: Json
          theme: string
          total_kr: number
          user_agent: string | null
          want_demo: boolean
        }
        Insert: {
          company?: string | null
          created_at?: string
          email: string
          email_error?: string | null
          email_sent?: boolean
          id?: string
          ip?: unknown
          name?: string | null
          params?: Json
          theme?: string
          total_kr?: number
          user_agent?: string | null
          want_demo?: boolean
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string
          email_error?: string | null
          email_sent?: boolean
          id?: string
          ip?: unknown
          name?: string | null
          params?: Json
          theme?: string
          total_kr?: number
          user_agent?: string | null
          want_demo?: boolean
        }
        Relationships: []
      }
      slack_oauth_state: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          state: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          state: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_oauth_state_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_locations: {
        Row: {
          barcode: string | null
          company_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_locations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_ai_disclosure: {
        Args: { p_company_id: string; p_provider: string; p_version: string }
        Returns: undefined
      }
      add_booking_service: {
        Args: {
          p_booking_id: string
          p_quantity?: number
          p_service_id: string
        }
        Returns: string
      }
      admin_platform_admins: {
        Args: never
        Returns: {
          created_at: string
          email: string
          email_confirmed_at: string
          last_sign_in_at: string
          user_id: string
        }[]
      }
      admin_set_platform_admin: {
        Args: { p_make_admin: boolean; p_target: string }
        Returns: undefined
      }
      admin_user_emails: {
        Args: never
        Returns: {
          email: string
          user_id: string
        }[]
      }
      admin_user_verification: {
        Args: never
        Returns: {
          email_confirmed_at: string
          last_sign_in_at: string
          user_id: string
        }[]
      }
      ai_disclosure_version: { Args: never; Returns: string }
      ai_label_usage: {
        Args: { p_company_id: string; p_from?: string; p_to?: string }
        Returns: {
          model: string
          reads: number
        }[]
      }
      ai_match_label_fields: {
        Args: {
          p_carrier?: string
          p_company_id: string
          p_receiver?: string
          p_sender?: string
        }
        Returns: Json
      }
      ai_model_costs_valid: { Args: { p: Json }; Returns: boolean }
      anonymize_asset_loan: {
        Args: { p_label?: string; p_loan_id: string }
        Returns: undefined
      }
      anonymize_employee: {
        Args: { p_employee_id: string; p_label?: string }
        Returns: boolean
      }
      anonymize_employee_internal: {
        Args: { p_employee_id: string; p_label?: string }
        Returns: boolean
      }
      anonymize_employees: {
        Args: { p_ids: string[]; p_label?: string }
        Returns: number
      }
      assert_booking_level: {
        Args: {
          p_company_id: string
          p_level_id: string
          p_require_active: boolean
        }
        Returns: undefined
      }
      assert_booking_not_retro: {
        Args: {
          p_all_day: boolean
          p_company_id: string
          p_ends_at: string
          p_starts_at: string
        }
        Returns: undefined
      }
      assert_booking_open: {
        Args: { p_booking_id: string }
        Returns: {
          all_day: boolean
          booked_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          created_at: string
          employee_id: string | null
          ends_at: string
          id: string
          invoiced_at: string | null
          invoiced_by: string | null
          participant_count: number | null
          participant_level_id: string | null
          resource_id: string
          starts_at: string
          status: Database["public"]["Enums"]["booking_status"]
          title: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_participant_count: {
        Args: { p_count: number }
        Returns: undefined
      }
      asset_flow_note: {
        Args: { p_asset_id: string; p_company_id: string; p_note: string }
        Returns: undefined
      }
      asset_status_from_text: {
        Args: { p_text: string }
        Returns: Database["public"]["Enums"]["asset_status"]
      }
      audit_actor_names: {
        Args: { p_company_id: string }
        Returns: {
          display_name: string | null
          platform: boolean
          user_id: string
        }[]
      }
      audit_category: { Args: { p_action: string }; Returns: string }
      audit_level: {
        Args: { p_action: string; p_detail?: Json }
        Returns: string
      }
      booking_tariffs_on: {
        Args: { p_company_id: string; p_on?: string; p_target_id: string }
        Returns: Database["public"]["Tables"]["booking_tariffs"]["Row"][]
      }
      can_cancel_bookings: { Args: { p_company_id: string }; Returns: boolean }
      can_manage_bookings: { Args: { p_company_id: string }; Returns: boolean }
      can_operate_assets: { Args: { p_company_id: string }; Returns: boolean }
      can_operate_bookings: { Args: { p_company_id: string }; Returns: boolean }
      can_write_assets: { Args: { p_company_id: string }; Returns: boolean }
      cancel_booking: {
        Args: { p_booking_id: string; p_reason: string }
        Returns: undefined
      }
      company_export_allowed: {
        Args: { p_company_id: string }
        Returns: boolean
      }
      company_export_begin: {
        Args: { p_company_id: string; p_groups: string[] }
        Returns: Json
      }
      company_export_catalog: {
        Args: never
        Returns: { grp: string; ord: number; tbl: string }[]
      }
      company_export_excluded: {
        Args: never
        Returns: { reason: string; tbl: string }[]
      }
      company_export_manifest: {
        Args: { p_company_id: string; p_groups: string[] }
        Returns: Json
      }
      company_export_rows: {
        Args: {
          p_after?: string
          p_company_id: string
          p_export_id: string
          p_limit?: number
          p_table: string
        }
        Returns: Json[]
      }
      company_export_ticket_ok: {
        Args: { p_company_id: string; p_export_id: string; p_table?: string }
        Returns: boolean
      }
      checkin_asset: {
        Args: {
          p_asset_id: string
          p_condition?: string
          p_location_id?: string
          p_note?: string
        }
        Returns: undefined
      }
      checkout_asset: {
        Args: { p_asset_id: string; p_employee_id: string; p_note?: string }
        Returns: undefined
      }
      create_asset_handheld: {
        Args: {
          p_barcode?: string
          p_category_id?: string
          p_company_id: string
          p_location_id?: string
          p_name: string
          p_serial_no?: string
        }
        Returns: {
          asset_tag: string
          id: string
        }[]
      }
      create_assets_batch: {
        Args: {
          p_category_id?: string
          p_company_id: string
          p_count: number
          p_location_id?: string
          p_name: string
        }
        Returns: {
          asset_tag: string
          id: string
        }[]
      }
      create_booking: {
        Args: {
          p_all_day?: boolean
          p_employee_id: string
          p_ends_at: string
          p_participant_count?: number
          p_participant_level_id?: string
          p_resource_id: string
          p_starts_at: string
          p_title?: string
        }
        Returns: string
      }
      current_company_id: { Args: never; Returns: string }
      employee_has_open_parcels: {
        Args: { p_employee_id: string }
        Returns: boolean
      }
      fold_contains: {
        Args: { p_haystack: string; p_needle: string }
        Returns: boolean
      }
      fold_name: { Args: { p_text: string }; Returns: string }
      generate_batch_code: { Args: { p_company_id: string }; Returns: string }
      generate_parcel_barcode: {
        Args: { p_company_id: string }
        Returns: string
      }
      get_login_options: { Args: never; Returns: Json }
      has_any_role: {
        Args: { p_roles: Database["public"]["Enums"]["app_role"][] }
        Returns: boolean
      }
      has_feature: { Args: { f: string }; Returns: boolean }
      has_product: { Args: { p: string }; Returns: boolean }
      has_role: {
        Args: { r: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      hook_password_verification_attempt: {
        Args: { event: Json }
        Returns: Json
      }
      impersonation_restore_auth_state: {
        Args: {
          p_email_confirmed_at: string
          p_last_sign_in_at: string
          p_user_id: string
        }
        Returns: undefined
      }
      is_platform_admin: { Args: never; Returns: boolean }
      lend_asset: {
        Args: {
          p_asset_id: string
          p_employee_id?: string
          p_note?: string
          p_to_address?: string
          p_to_email?: string
          p_to_name?: string
          p_to_phone?: string
          p_ttl_hours?: number
        }
        Returns: string
      }
      log_booking_export: {
        Args: {
          p_company_id: string
          p_detail?: Json
          p_rows: number
          p_scope: string
        }
        Returns: undefined
      }
      log_company_export: {
        Args: {
          p_company_id: string
          p_export_id: string
          p_files?: number
          p_rows: number
          p_tables: number
        }
        Returns: undefined
      }
      log_failed_login_attempt: {
        Args: { p_email: string }
        Returns: undefined
      }
      log_gateway_event: {
        Args: {
          p_action: string
          p_company_id: string
          p_detail?: Json
          p_summary: string
        }
        Returns: undefined
      }
      log_login_success: { Args: never; Returns: undefined }
      log_notification_event: {
        Args: {
          p_action: string
          p_actor?: string
          p_company_id: string
          p_detail?: Json
          p_entity_id: string
          p_entity_type: string
          p_summary: string
        }
        Returns: undefined
      }
      log_password_reset_done: { Args: never; Returns: undefined }
      log_password_reset_requested: {
        Args: {
          p_email: string
          p_email_error?: string
          p_email_sent?: boolean
        }
        Returns: undefined
      }
      mask_login_email: { Args: { p_email: string }; Returns: string }
      move_asset: {
        Args: { p_asset_id: string; p_location_id: string; p_note?: string }
        Returns: undefined
      }
      name_score: { Args: { p_a: string; p_b: string }; Returns: number }
      name_score_folded: { Args: { p_a: string; p_b: string }; Returns: number }
      name_similarity: { Args: { p_a: string; p_b: string }; Returns: number }
      next_asset_no: { Args: { p_company_id: string }; Returns: string }
      next_asset_no_unchecked: {
        Args: { p_company_id: string }
        Returns: string
      }
      next_parcel_barcode: { Args: { p_company_id: string }; Returns: string }
      override_parcel_receiver: {
        Args: {
          p_delivered_employee_id?: string
          p_delivered_to: string
          p_note?: string
          p_parcel_ids: string[]
          p_reason: string
          p_signature_path?: string
        }
        Returns: number
      }
      parcel_sender_suggestions: {
        Args: { p_company_id: string }
        Returns: string[]
      }
      parcel_transition_allowed: {
        Args: {
          from_s: Database["public"]["Enums"]["parcel_status"]
          to_s: Database["public"]["Enums"]["parcel_status"]
        }
        Returns: boolean
      }
      purge_booking_notifications: { Args: never; Returns: undefined }
      record_account_email: {
        Args: {
          p_email: string
          p_kind: string
          p_provider: string
          p_provider_id: string
        }
        Returns: undefined
      }
      record_ai_label_read: {
        Args: {
          p_actor: string
          p_company_id: string
          p_duration_ms?: number
          p_fields_found?: number
          p_image_bytes?: number
          p_model: string
          p_outcome: string
          p_provider: string
          p_source?: string
        }
        Returns: undefined
      }
      record_audit: {
        Args: {
          p_action: string
          p_actor?: string
          p_company_id: string
          p_detail?: Json
          p_entity_id: string
          p_entity_type: string
          p_summary: string
        }
        Returns: undefined
      }
      reinstate_asset: { Args: { p_asset_id: string }; Returns: undefined }
      release_import_lock: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      release_import_lock_self: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      remove_booking_service: {
        Args: { p_line_id: string }
        Returns: undefined
      }
      remove_parcel: {
        Args: { p_parcel_ids: string[]; p_reason: string }
        Returns: number
      }
      renumber_asset: { Args: { p_asset_id: string }; Returns: string }
      retention_days: {
        Args: { p_category: string; p_company_id: string }
        Returns: number
      }
      retire_asset: {
        Args: { p_asset_id: string; p_note?: string; p_reason: string }
        Returns: undefined
      }
      retire_employee: {
        Args: { p_anonymize: boolean; p_employee_id: string; p_label?: string }
        Returns: string
      }
      return_asset: { Args: { p_asset_id: string }; Returns: undefined }
      run_retention_purge: { Args: never; Returns: undefined }
      sar_export: {
        Args: { p_company_id: string; p_employee_id?: string; p_query?: string }
        Returns: Json
      }
      sar_section_limit: { Args: never; Returns: number }
      send_asset_to_service: {
        Args: {
          p_asset_id: string
          p_expected_back?: string
          p_note?: string
          p_vendor?: string
        }
        Returns: undefined
      }
      set_app_texts: {
        Args: { p_company_id: string; p_entries: Json; p_platform: string }
        Returns: Json
      }
      set_booking_invoiced: {
        Args: { p_booking_id: string; p_invoiced?: boolean }
        Returns: undefined
      }
      set_company_sftp_password: {
        Args: { p_company_id: string; p_password: string }
        Returns: undefined
      }
      sftp_auth_lookup: {
        Args: { p_password: string; p_username: string }
        Returns: {
          company_id: string
        }[]
      }
      sweep_retired_employees: {
        Args: { p_company_id: string; p_label?: string }
        Returns: number
      }
      sweep_returned_loans: { Args: { p_company_id?: string }; Returns: number }
      try_import_lock: { Args: { p_company_id: string }; Returns: boolean }
      try_import_lock_self: { Args: { p_company_id: string }; Returns: boolean }
      unretire_employee: { Args: { p_employee_id: string }; Returns: undefined }
      update_asset_loan: {
        Args: {
          p_expires_at?: string
          p_loan_id: string
          p_note?: string
          p_to_address?: string
          p_to_email?: string
          p_to_name: string
          p_to_phone?: string
        }
        Returns: undefined
      }
      update_booking: {
        Args: {
          p_all_day?: boolean
          p_booking_id: string
          p_employee_id: string
          p_ends_at: string
          p_participant_count?: number
          p_participant_level_id?: string
          p_resource_id: string
          p_starts_at: string
          p_title?: string
        }
        Returns: undefined
      }
      update_booking_service: {
        Args: { p_line_id: string; p_quantity: number }
        Returns: undefined
      }
      write_off_asset: {
        Args: { p_asset_id: string; p_note?: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "manager"
        | "parcel_handler"
        | "final_receiver"
        | "data_manager"
        | "parcel_manager"
        | "handheld_parcel_handler"
        | "asset_handler"
        | "asset_manager"
        | "handheld_asset_handler"
        | "inventory_handler"
        | "inventory_manager"
        | "handheld_inventory_handler"
        | "route_planner_handler"
        | "route_planner_manager"
        | "handheld_route_planner"
        | "booking_manager"
        | "booking_handler"
      asset_status:
        | "in_stock"
        | "assigned"
        | "on_loan"
        | "service"
        | "retired"
        | "written_off"
      batch_status: "open" | "finished"
      booking_notification_audience: "employee" | "booker" | "copy" | "economy"
      booking_notification_kind:
        | "created"
        | "updated"
        | "cancelled"
        | "reminder"
        | "invoiced"
      booking_status: "booked" | "cancelled"
      notification_channel: "email" | "sms" | "teams" | "slack"
      notification_kind:
        | "arrival"
        | "reminder_1"
        | "reminder_2"
        | "manual"
        | "status"
      notification_status: "sent" | "failed" | "skipped"
      parcel_status:
        | "unassigned"
        | "registered"
        | "in_storage"
        | "in_transit"
        | "in_locker"
        | "delivered"
        | "rejected"
        | "returned"
        | "removed"
      parcel_type: "package" | "pallet" | "letter"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "manager",
        "parcel_handler",
        "final_receiver",
        "data_manager",
        "parcel_manager",
        "handheld_parcel_handler",
        "asset_handler",
        "asset_manager",
        "handheld_asset_handler",
        "inventory_handler",
        "inventory_manager",
        "handheld_inventory_handler",
        "route_planner_handler",
        "route_planner_manager",
        "handheld_route_planner",
        "booking_manager",
        "booking_handler",
      ],
      asset_status: [
        "in_stock",
        "assigned",
        "on_loan",
        "service",
        "retired",
        "written_off",
      ],
      batch_status: ["open", "finished"],
      booking_notification_audience: ["employee", "booker", "copy", "economy"],
      booking_notification_kind: [
        "created",
        "updated",
        "cancelled",
        "reminder",
        "invoiced",
      ],
      booking_status: ["booked", "cancelled"],
      notification_channel: ["email", "sms", "teams", "slack"],
      notification_kind: [
        "arrival",
        "reminder_1",
        "reminder_2",
        "manual",
        "status",
      ],
      notification_status: ["sent", "failed", "skipped"],
      parcel_status: [
        "unassigned",
        "registered",
        "in_storage",
        "in_transit",
        "in_locker",
        "delivered",
        "rejected",
        "returned",
        "removed",
      ],
      parcel_type: ["package", "pallet", "letter"],
    },
  },
} as const

