import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Db, GridFSBucket, MongoClient } from 'mongodb';

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const uri = this.config.get<string>('MONGODB_URI')?.trim();
    if (!uri) {
      throw new Error(
        'MONGODB_URI is required — uploads are stored in MongoDB GridFS',
      );
    }

    this.client = new MongoClient(uri);
    await this.client.connect();

    const dbName = this.config.get<string>('MONGODB_DB_NAME')?.trim();
    this.db = dbName ? this.client.db(dbName) : this.client.db();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.db = null;
  }

  getDb(): Db {
    if (!this.db) {
      throw new Error('MongoDB is not connected');
    }
    return this.db;
  }

  getUploadsBucket(): GridFSBucket {
    const bucketName =
      this.config.get<string>('GRIDFS_BUCKET_NAME')?.trim() || 'uploads';
    return new GridFSBucket(this.getDb(), { bucketName });
  }

  /**
   * Files that must never be reachable by URL alone: signed application forms, identity
   * documents, anything with a national ID number on it. `/uploads/*` streams the uploads
   * bucket to anyone who holds the path; this bucket has no such route, and is read only by
   * services that check who is asking first.
   */
  getPrivateDocumentsBucket(): GridFSBucket {
    const bucketName =
      this.config.get<string>('GRIDFS_PRIVATE_BUCKET_NAME')?.trim() ||
      'private_documents';
    return new GridFSBucket(this.getDb(), { bucketName });
  }
}
