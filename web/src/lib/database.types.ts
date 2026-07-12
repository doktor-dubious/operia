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
      assets: {
        Row: {
          asset_tag: string | null
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
          serial_no: string | null
          status: string | null
          warranty_until: string | null
        }
        Insert: {
          asset_tag?: string | null
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
          serial_no?: string | null
          status?: string | null
          warranty_until?: string | null
        }
        Update: {
          asset_tag?: string | null
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
          serial_no?: string | null
          status?: string | null
          warranty_until?: string | null
        }
        Relationships: [
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
          company_id: string | null
          created_at: string
          detail: Json
          entity_id: string | null
          entity_type: string
          id: number
          summary: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          company_id?: string | null
          created_at?: string
          detail?: Json
          entity_id?: string | null
          entity_type: string
          id?: never
          summary?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          company_id?: string | null
          created_at?: string
          detail?: Json
          entity_id?: string | null
          entity_type?: string
          id?: never
          summary?: string | null
        }
        Relationships: []
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
          created_at: string
          default_currency: string
          default_language: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          parcel_reminder_1_days: number | null
          parcel_reminder_1_enabled: boolean | null
          parcel_reminder_2_days: number | null
          parcel_reminder_2_enabled: boolean | null
          parcel_reminder_max: number | null
          purchasing_email: string | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          registration_no: string | null
          shipping_byoc_fee: number | null
          shipping_byoc_subscription: number | null
          shipping_margin_fixed: number | null
          shipping_margin_percent: number | null
          shipping_model: string | null
          supported_currencies: string[]
          supported_languages: string[]
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_currency?: string
          default_language?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          parcel_reminder_1_days?: number | null
          parcel_reminder_1_enabled?: boolean | null
          parcel_reminder_2_days?: number | null
          parcel_reminder_2_enabled?: boolean | null
          parcel_reminder_max?: number | null
          purchasing_email?: string | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          registration_no?: string | null
          shipping_byoc_fee?: number | null
          shipping_byoc_subscription?: number | null
          shipping_margin_fixed?: number | null
          shipping_margin_percent?: number | null
          shipping_model?: string | null
          supported_currencies?: string[]
          supported_languages?: string[]
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_currency?: string
          default_language?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          parcel_reminder_1_days?: number | null
          parcel_reminder_1_enabled?: boolean | null
          parcel_reminder_2_days?: number | null
          parcel_reminder_2_enabled?: boolean | null
          parcel_reminder_max?: number | null
          purchasing_email?: string | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          registration_no?: string | null
          shipping_byoc_fee?: number | null
          shipping_byoc_subscription?: number | null
          shipping_margin_fixed?: number | null
          shipping_margin_percent?: number | null
          shipping_model?: string | null
          supported_currencies?: string[]
          supported_languages?: string[]
          timezone?: string
          updated_at?: string
        }
        Relationships: []
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
          first_name: string | null
          full_name: string
          id: string
          initials: string | null
          is_active: boolean
          is_manual: boolean
          language: string
          last_name: string | null
          nfc_card_id: string | null
          phone: string | null
          role: string | null
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
          first_name?: string | null
          full_name: string
          id?: string
          initials?: string | null
          is_active?: boolean
          is_manual?: boolean
          language?: string
          last_name?: string | null
          nfc_card_id?: string | null
          phone?: string | null
          role?: string | null
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
          first_name?: string | null
          full_name?: string
          id?: string
          initials?: string | null
          is_active?: boolean
          is_manual?: boolean
          language?: string
          last_name?: string | null
          nfc_card_id?: string | null
          phone?: string | null
          role?: string | null
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
      parcels: {
        Row: {
          barcode: string | null
          carrier_id: string | null
          company_id: string
          condition_note: string | null
          condition_photo_path: string | null
          condition_preset: string | null
          created_at: string
          delivered_at: string | null
          delivered_note: string | null
          delivered_signature_path: string | null
          delivered_to: string | null
          department_id: string | null
          handling_class_id: string | null
          id: string
          is_private: boolean
          parcel_type: Database["public"]["Enums"]["parcel_type"]
          receiver_employee_id: string | null
          registered_at: string
          registered_by: string | null
          sender: string | null
          status: Database["public"]["Enums"]["parcel_status"]
          storage_location_id: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          carrier_id?: string | null
          company_id: string
          condition_note?: string | null
          condition_photo_path?: string | null
          condition_preset?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_note?: string | null
          delivered_signature_path?: string | null
          delivered_to?: string | null
          department_id?: string | null
          handling_class_id?: string | null
          id?: string
          is_private?: boolean
          parcel_type?: Database["public"]["Enums"]["parcel_type"]
          receiver_employee_id?: string | null
          registered_at?: string
          registered_by?: string | null
          sender?: string | null
          status?: Database["public"]["Enums"]["parcel_status"]
          storage_location_id?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          carrier_id?: string | null
          company_id?: string
          condition_note?: string | null
          condition_photo_path?: string | null
          condition_preset?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_note?: string | null
          delivered_signature_path?: string | null
          delivered_to?: string | null
          department_id?: string | null
          handling_class_id?: string | null
          id?: string
          is_private?: boolean
          parcel_type?: Database["public"]["Enums"]["parcel_type"]
          receiver_employee_id?: string | null
          registered_at?: string
          registered_by?: string | null
          sender?: string | null
          status?: Database["public"]["Enums"]["parcel_status"]
          storage_location_id?: string | null
          updated_at?: string
        }
        Relationships: [
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
      platform_settings: {
        Row: {
          default_currency: string
          default_language: string
          id: boolean
          locker_loan_ttl_hours: number | null
          parcel_reminder_1_days: number
          parcel_reminder_1_enabled: boolean
          parcel_reminder_2_days: number
          parcel_reminder_2_enabled: boolean
          parcel_reminder_max: number
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          shipping_byoc_fee: number
          shipping_byoc_subscription: number
          shipping_margin_fixed: number
          shipping_margin_percent: number
          shipping_model: string
          supported_currencies: string[]
          supported_languages: string[]
          updated_at: string
        }
        Insert: {
          default_currency?: string
          default_language?: string
          id?: boolean
          locker_loan_ttl_hours?: number | null
          parcel_reminder_1_days?: number
          parcel_reminder_1_enabled?: boolean
          parcel_reminder_2_days?: number
          parcel_reminder_2_enabled?: boolean
          parcel_reminder_max?: number
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          shipping_byoc_fee?: number
          shipping_byoc_subscription?: number
          shipping_margin_fixed?: number
          shipping_margin_percent?: number
          shipping_model?: string
          supported_currencies?: string[]
          supported_languages?: string[]
          updated_at?: string
        }
        Update: {
          default_currency?: string
          default_language?: string
          id?: boolean
          locker_loan_ttl_hours?: number | null
          parcel_reminder_1_days?: number
          parcel_reminder_1_enabled?: boolean
          parcel_reminder_2_days?: number
          parcel_reminder_2_enabled?: boolean
          parcel_reminder_max?: number
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          shipping_byoc_fee?: number
          shipping_byoc_subscription?: number
          shipping_margin_fixed?: number
          shipping_margin_percent?: number
          shipping_model?: string
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
      current_company_id: { Args: never; Returns: string }
      has_feature: { Args: { f: string }; Returns: boolean }
      has_product: { Args: { p: string }; Returns: boolean }
      has_role: {
        Args: { r: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      parcel_transition_allowed: {
        Args: {
          from_s: Database["public"]["Enums"]["parcel_status"]
          to_s: Database["public"]["Enums"]["parcel_status"]
        }
        Returns: boolean
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
    }
    Enums: {
      app_role: "manager" | "parcel_handler" | "final_receiver"
      parcel_status:
        | "unassigned"
        | "registered"
        | "in_storage"
        | "in_transit"
        | "in_locker"
        | "delivered"
        | "rejected"
        | "returned"
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
      app_role: ["manager", "parcel_handler", "final_receiver"],
      parcel_status: [
        "unassigned",
        "registered",
        "in_storage",
        "in_transit",
        "in_locker",
        "delivered",
        "rejected",
        "returned",
      ],
      parcel_type: ["package", "pallet", "letter"],
    },
  },
} as const
