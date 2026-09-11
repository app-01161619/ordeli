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
      customers: {
        Row: {
          created_at: string
          id: string
          name: string
          phone: string | null
          seller_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          seller_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          seller_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      event_change_logs: {
        Row: {
          changed_by_user_id: string | null
          event_id: string
          id: string
          new_end_time: string | null
          new_event_date: string | null
          new_start_time: string | null
          occurred_at: string
          original_end_time: string | null
          original_event_date: string | null
          original_start_time: string | null
          reason: string | null
        }
        Insert: {
          changed_by_user_id?: string | null
          event_id: string
          id?: string
          new_end_time?: string | null
          new_event_date?: string | null
          new_start_time?: string | null
          occurred_at?: string
          original_end_time?: string | null
          original_event_date?: string | null
          original_start_time?: string | null
          reason?: string | null
        }
        Update: {
          changed_by_user_id?: string | null
          event_id?: string
          id?: string
          new_end_time?: string | null
          new_event_date?: string | null
          new_start_time?: string | null
          occurred_at?: string
          original_end_time?: string | null
          original_event_date?: string | null
          original_start_time?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_change_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          end_time: string | null
          event_date: string
          id: string
          location: string
          name: string
          notes: string | null
          seller_id: string
          start_time: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_time?: string | null
          event_date: string
          id?: string
          location: string
          name: string
          notes?: string | null
          seller_id: string
          start_time?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_time?: string | null
          event_date?: string
          id?: string
          location?: string
          name?: string
          notes?: string | null
          seller_id?: string
          start_time?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_order_syncs: {
        Row: {
          client_order_id: string
          device_id: string
          order_id: string
          seller_id: string
          synced_at: string
        }
        Insert: {
          client_order_id: string
          device_id: string
          order_id: string
          seller_id: string
          synced_at?: string
        }
        Update: {
          client_order_id?: string
          device_id?: string
          order_id?: string
          seller_id?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offline_order_syncs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_financial_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "offline_order_syncs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_order_syncs_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_qr_reservations: {
        Row: {
          device_id: string
          qr_code_id: string
          reserved_at: string
          seller_id: string
        }
        Insert: {
          device_id: string
          qr_code_id: string
          reserved_at?: string
          seller_id: string
        }
        Update: {
          device_id?: string
          qr_code_id?: string
          reserved_at?: string
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offline_qr_reservations_qr_code_id_fkey"
            columns: ["qr_code_id"]
            isOneToOne: true
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_qr_reservations_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      order_event_history: {
        Row: {
          changed_by_user_id: string | null
          id: string
          new_event_id: string | null
          occurred_at: string
          old_event_id: string | null
          order_id: string
          reason: string | null
        }
        Insert: {
          changed_by_user_id?: string | null
          id?: string
          new_event_id?: string | null
          occurred_at?: string
          old_event_id?: string | null
          order_id: string
          reason?: string | null
        }
        Update: {
          changed_by_user_id?: string | null
          id?: string
          new_event_id?: string | null
          occurred_at?: string
          old_event_id?: string | null
          order_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_event_history_new_event_id_fkey"
            columns: ["new_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_event_history_old_event_id_fkey"
            columns: ["old_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_event_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_financial_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_event_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          cancel_reason: string | null
          cancellable_until_stage: number | null
          cancelled_at: string | null
          created_at: string
          id: string
          order_id: string
          product_id: string
          product_name: string
          qr_code_id: string | null
          quantity: number
          seller_id: string
          total_price: number
          unit_price: number
          updated_at: string
          workflow_snapshot: Json
        }
        Insert: {
          cancel_reason?: string | null
          cancellable_until_stage?: number | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          order_id: string
          product_id: string
          product_name: string
          qr_code_id?: string | null
          quantity: number
          seller_id: string
          total_price: number
          unit_price: number
          updated_at?: string
          workflow_snapshot?: Json
        }
        Update: {
          cancel_reason?: string | null
          cancellable_until_stage?: number | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string
          product_name?: string
          qr_code_id?: string | null
          quantity?: number
          seller_id?: string
          total_price?: number
          unit_price?: number
          updated_at?: string
          workflow_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_financial_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_qr_code_id_fkey"
            columns: ["qr_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          customer_id: string
          event_id: string | null
          fulfillment_type: string
          handed_over_at: string | null
          id: string
          order_number: number
          pickup_status: string
          seller_id: string
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          customer_id: string
          event_id?: string | null
          fulfillment_type?: string
          handed_over_at?: string | null
          id?: string
          order_number?: never
          pickup_status?: string
          seller_id: string
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          customer_id?: string
          event_id?: string | null
          fulfillment_type?: string
          handed_over_at?: string | null
          id?: string
          order_number?: never
          pickup_status?: string
          seller_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          confirmed_at: string | null
          confirmed_by_user_id: string | null
          created_at: string
          id: string
          order_id: string
          payment_method: string | null
          payment_type: string
          proof_path: string | null
          proof_status: string | null
          rejection_reason: string | null
          seller_id: string
        }
        Insert: {
          amount: number
          confirmed_at?: string | null
          confirmed_by_user_id?: string | null
          created_at?: string
          id?: string
          order_id: string
          payment_method?: string | null
          payment_type: string
          proof_path?: string | null
          proof_status?: string | null
          rejection_reason?: string | null
          seller_id: string
        }
        Update: {
          amount?: number
          confirmed_at?: string | null
          confirmed_by_user_id?: string | null
          created_at?: string
          id?: string
          order_id?: string
          payment_method?: string | null
          payment_type?: string
          proof_path?: string | null
          proof_status?: string | null
          rejection_reason?: string | null
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_financial_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      production_members: {
        Row: {
          auth_user_id: string | null
          can_finish_stage: boolean
          can_scan_qr: boolean
          can_upload_proof: boolean
          can_view_production: boolean
          created_at: string
          email: string | null
          id: string
          invite_status: string
          invite_token: string | null
          is_active: boolean
          name: string
          role: string
          section_label: string | null
          seller_id: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          can_finish_stage?: boolean
          can_scan_qr?: boolean
          can_upload_proof?: boolean
          can_view_production?: boolean
          created_at?: string
          email?: string | null
          id?: string
          invite_status?: string
          invite_token?: string | null
          is_active?: boolean
          name: string
          role?: string
          section_label?: string | null
          seller_id: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          can_finish_stage?: boolean
          can_scan_qr?: boolean
          can_upload_proof?: boolean
          can_view_production?: boolean
          created_at?: string
          email?: string | null
          id?: string
          invite_status?: string
          invite_token?: string | null
          is_active?: boolean
          name?: string
          role?: string
          section_label?: string | null
          seller_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_members_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      production_stages: {
        Row: {
          created_at: string
          id: string
          name: string
          product_id: string
          stage_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          product_id: string
          stage_order: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          product_id?: string
          stage_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_stages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          customer_cancellable_until_stage: number | null
          default_price: number
          id: string
          is_active: boolean
          name: string
          seller_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_cancellable_until_stage?: number | null
          default_price?: number
          id?: string
          is_active?: boolean
          name: string
          seller_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_cancellable_until_stage?: number | null
          default_price?: number
          id?: string
          is_active?: boolean
          name?: string
          seller_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_codes: {
        Row: {
          assigned_at: string | null
          code: string
          created_at: string
          id: string
          order_item_id: string | null
          product_id: string
          public_token: string
          revoked_at: string | null
          seller_id: string
          series_name: string | null
          series_sequence: number | null
          status: string
        }
        Insert: {
          assigned_at?: string | null
          code: string
          created_at?: string
          id?: string
          order_item_id?: string | null
          product_id: string
          public_token: string
          revoked_at?: string | null
          seller_id: string
          series_name?: string | null
          series_sequence?: number | null
          status?: string
        }
        Update: {
          assigned_at?: string | null
          code?: string
          created_at?: string
          id?: string
          order_item_id?: string | null
          product_id?: string
          public_token?: string
          revoked_at?: string | null
          seller_id?: string
          series_name?: string | null
          series_sequence?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "qr_codes_order_item_fk"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          created_at: string
          id: string
          order_id: string
          rating: number
          review_text: string | null
          seller_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          rating: number
          review_text?: string | null
          seller_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          rating?: number
          review_text?: string | null
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "order_financial_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      sellers: {
        Row: {
          created_at: string
          email: string | null
          google_id: string | null
          id: string
          login_method: string
          shop_address: string | null
          shop_logo_path: string | null
          shop_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          google_id?: string | null
          id: string
          login_method?: string
          shop_address?: string | null
          shop_logo_path?: string | null
          shop_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          google_id?: string | null
          id?: string
          login_method?: string
          shop_address?: string | null
          shop_logo_path?: string | null
          shop_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sms_update_drafts: {
        Row: {
          created_at: string
          id: string
          message_text: string
          order_id: string
          seller_id: string
          sent_marked_at: string | null
          status: string
          triggered_by_user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message_text: string
          order_id: string
          seller_id: string
          sent_marked_at?: string | null
          status?: string
          triggered_by_user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message_text?: string
          order_id?: string
          seller_id?: string
          sent_marked_at?: string | null
          status?: string
          triggered_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_update_drafts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_financial_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "sms_update_drafts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_update_drafts_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_logs: {
        Row: {
          action: string
          id: string
          note: string | null
          occurred_at: string
          order_item_id: string
          performed_by_user_id: string | null
          proof_photo_path: string | null
          stage_name: string
          stage_order: number
        }
        Insert: {
          action: string
          id?: string
          note?: string | null
          occurred_at?: string
          order_item_id: string
          performed_by_user_id?: string | null
          proof_photo_path?: string | null
          stage_name: string
          stage_order: number
        }
        Update: {
          action?: string
          id?: string
          note?: string | null
          occurred_at?: string
          order_item_id?: string
          performed_by_user_id?: string | null
          proof_photo_path?: string | null
          stage_name?: string
          stage_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "stage_logs_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      order_financial_summary: {
        Row: {
          order_id: string | null
          order_number: number | null
          order_total: number | null
          remaining_balance: number | null
          seller_id: string | null
          total_paid: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_production_member_invite: {
        Args: { p_invite_token: string }
        Returns: Json
      }
      add_order_item_from_qr: {
        Args: {
          p_device_id?: string
          p_order_id: string
          p_qr_public_token: string
          p_quantity?: number
        }
        Returns: Json
      }
      add_order_item_online: {
        Args: {
          p_device_id: string
          p_order_id: string
          p_qr_public_token: string
          p_quantity: number
        }
        Returns: Json
      }
      cancel_customer_order_item: {
        Args: { p_public_token: string; p_reason?: string }
        Returns: Json
      }
      create_order: {
        Args: {
          requested_customer_name: string
          requested_customer_phone: string
          requested_items: Json
        }
        Returns: string
      }
      create_order_from_qr: {
        Args: {
          p_customer_id?: string
          p_customer_name?: string
          p_customer_phone?: string
          p_device_id?: string
          p_downpayment?: number
          p_qr_public_token: string
          p_quantity?: number
        }
        Returns: Json
      }
      create_order_from_scanned_qr: {
        Args: {
          requested_customer_name: string
          requested_customer_phone: string
          requested_downpayment: number
          requested_qr_code_id: string
          requested_quantity: number
        }
        Returns: string
      }
      create_production_member_invite: {
        Args: {
          p_can_finish_stage?: boolean
          p_can_scan_qr?: boolean
          p_can_upload_proof?: boolean
          p_can_view_production?: boolean
          p_email: string
          p_name: string
          p_section_label?: string
        }
        Returns: Json
      }
      create_qr_series: {
        Args: {
          requested_product_id: string
          requested_quantity: number
          requested_series_name: string
        }
        Returns: string
      }
      customer_tracking_token_exists: {
        Args: { p_public_token: string }
        Returns: boolean
      }
      finish_production_stage: {
        Args: {
          p_note?: string
          p_order_item_id: string
          p_stage_name: string
          p_stage_order: number
        }
        Returns: Json
      }
      finish_production_stage_member: {
        Args: { p_note?: string; p_order_item_id: string }
        Returns: Json
      }
      finish_production_stage_member_v2: {
        Args: {
          p_note?: string
          p_order_item_id: string
          p_proof_photo_path?: string
        }
        Returns: Json
      }
      generate_qr_series: {
        Args: {
          requested_product_id: string
          requested_quantity: number
          requested_series_name: string
        }
        Returns: number
      }
      get_current_actor: { Args: never; Returns: Json }
      get_customer_fulfillment: {
        Args: { p_public_token: string }
        Returns: Json
      }
      get_customer_payment_proof: {
        Args: { p_public_token: string }
        Returns: Json
      }
      get_customer_post_purchase_actions: {
        Args: { p_public_token: string }
        Returns: Json
      }
      get_customer_stage_proof: {
        Args: { p_public_token: string; p_stage_order: number }
        Returns: Json
      }
      get_customer_stage_proof_v2: {
        Args: { p_public_token: string; p_stage_order: number }
        Returns: Json
      }
      get_customer_tracking: { Args: { p_public_token: string }; Returns: Json }
      get_login_identifier: {
        Args: { requested_shop_name: string }
        Returns: string
      }
      get_production_invite: { Args: { p_invite_token: string }; Returns: Json }
      get_production_work: { Args: { p_limit?: number }; Returns: Json }
      product_belongs_to_current_seller: {
        Args: { requested_product_id: string }
        Returns: boolean
      }
      production_member_can_upload_to_seller: {
        Args: { p_seller_id_text: string }
        Returns: boolean
      }
      qr_product_prefix: { Args: { requested_name: string }; Returns: string }
      queue_sms_update: {
        Args: {
          p_message: string
          p_order_id: string
          p_seller_id: string
          p_triggered_by_user_id?: string
        }
        Returns: string
      }
      release_qr_reservations_for_offline: {
        Args: {
          p_device_id: string
          p_product_id: string
          p_series_name: string
        }
        Returns: number
      }
      reschedule_customer_pickup: {
        Args: { p_new_event_id: string; p_public_token: string }
        Returns: Json
      }
      reschedule_event_orders: {
        Args: { p_event_id: string; p_new_event_id: string; p_reason?: string }
        Returns: Json
      }
      reserve_qr_codes_for_offline: {
        Args: {
          p_device_id: string
          p_product_id: string
          p_quantity: number
          p_series_name: string
        }
        Returns: number
      }
      resolve_production_qr: { Args: { p_public_token: string }; Returns: Json }
      review_customer_payment: {
        Args: {
          p_decision: string
          p_payment_id: string
          p_rejection_reason?: string
        }
        Returns: Json
      }
      revoke_qr_code: { Args: { p_code: string }; Returns: Json }
      seller_cancel_order: {
        Args: { p_order_id: string; p_reason?: string }
        Returns: Json
      }
      seller_cancel_order_item: {
        Args: { p_order_item_id: string; p_reason?: string }
        Returns: Json
      }
      seller_record_payment: {
        Args: { p_amount: number; p_order_id: string; p_payment_type?: string }
        Returns: Json
      }
      send_back_production_stage: {
        Args: {
          p_order_item_id: string
          p_stage_name: string
          p_stage_order: number
        }
        Returns: Json
      }
      set_customer_fulfillment: {
        Args: {
          p_event_id?: string
          p_fulfillment_type: string
          p_public_token: string
        }
        Returns: Json
      }
      set_production_member_active: {
        Args: { p_active: boolean; p_member_id: string }
        Returns: {
          auth_user_id: string | null
          can_finish_stage: boolean
          can_scan_qr: boolean
          can_upload_proof: boolean
          can_view_production: boolean
          created_at: string
          email: string | null
          id: string
          invite_status: string
          invite_token: string | null
          is_active: boolean
          name: string
          role: string
          section_label: string | null
          seller_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "production_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_seller_payment_method: {
        Args: { p_payment_id: string; p_payment_method: string }
        Returns: Json
      }
      submit_customer_payment_proof: {
        Args: { p_amount: number; p_proof_path: string; p_public_token: string }
        Returns: Json
      }
      submit_customer_review: {
        Args: {
          p_public_token: string
          p_rating: number
          p_review_text?: string
        }
        Returns: Json
      }
      sync_offline_order:
        | {
            Args: {
              p_client_order_id: string
              p_created_offline?: boolean
              p_customer_id?: string
              p_customer_name?: string
              p_customer_phone?: string
              p_device_id: string
              p_downpayment?: number
              p_qr_public_token: string
              p_quantity?: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_client_order_id: string
              p_customer_id?: string
              p_customer_name?: string
              p_customer_phone?: string
              p_device_id: string
              p_downpayment?: number
              p_qr_public_token: string
              p_quantity?: number
            }
            Returns: Json
          }
      sync_offline_order_v2: {
        Args: {
          p_client_order_id: string
          p_customer_id?: string
          p_customer_name?: string
          p_customer_phone?: string
          p_device_id: string
          p_downpayment?: number
          p_qr_public_token: string
          p_quantity?: number
        }
        Returns: Json
      }
      sync_offline_order_v3: {
        Args: {
          p_client_order_id: string
          p_customer_id?: string
          p_customer_name?: string
          p_customer_phone?: string
          p_device_id: string
          p_downpayment?: number
          p_qr_public_token: string
          p_quantity?: number
        }
        Returns: Json
      }
      sync_offline_order_v4: {
        Args: {
          p_client_order_id: string
          p_customer_id?: string
          p_customer_name?: string
          p_customer_phone?: string
          p_device_id: string
          p_downpayment?: number
          p_qr_public_token: string
          p_quantity?: number
        }
        Returns: Json
      }
      sync_offline_order_v5: {
        Args: {
          p_client_order_id: string
          p_customer_id?: string
          p_customer_name?: string
          p_customer_phone?: string
          p_device_id: string
          p_downpayment?: number
          p_qr_public_token: string
          p_quantity?: number
        }
        Returns: Json
      }
      update_order_pickup_status: {
        Args: { p_action: string; p_order_id: string }
        Returns: Json
      }
      update_production_member: {
        Args: {
          p_can_finish_stage: boolean
          p_can_scan_qr: boolean
          p_can_upload_proof: boolean
          p_can_view_production: boolean
          p_member_id: string
          p_name: string
          p_section_label: string
        }
        Returns: {
          auth_user_id: string | null
          can_finish_stage: boolean
          can_scan_qr: boolean
          can_upload_proof: boolean
          can_view_production: boolean
          created_at: string
          email: string | null
          id: string
          invite_status: string
          invite_token: string | null
          is_active: boolean
          name: string
          role: string
          section_label: string | null
          seller_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "production_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
