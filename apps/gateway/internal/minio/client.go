package minio

import (
	"context"
	"fmt"

	"github.com/adnaneca/aetherspec/apps/gateway/internal/config"
	miniogo "github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"go.uber.org/zap"
)

// New creates a MinIO client.
func New(cfg *config.Config, log *zap.Logger) (*miniogo.Client, error) {
	useSSL := cfg.MinIO.UseSSL == "true"

	client, err := miniogo.New(cfg.MinIO.Endpoint,
		&miniogo.Options{
			Creds:  credentials.NewStaticV4(cfg.MinIO.AccessKey, cfg.MinIO.SecretKey, ""),
			Secure: useSSL,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("minio client init: %w", err)
	}

	// Verify connection by checking the default bucket.
	ctx := context.Background()
	ok, err := client.BucketExists(ctx, cfg.MinIO.Bucket)
	if err != nil {
		return nil, fmt.Errorf("minio connection check: %w", err)
	}
	if !ok {
		log.Warn("default bucket does not exist", zap.String("bucket", cfg.MinIO.Bucket))
	} else {
		log.Info("minio connected", zap.String("bucket", cfg.MinIO.Bucket))
	}

	return client, nil
}

// EnsureBucket creates a bucket if it doesn't exist.
func EnsureBucket(client *miniogo.Client, ctx context.Context, bucketName string) error {
	ok, err := client.BucketExists(ctx, bucketName)
	if err != nil {
		return fmt.Errorf("check bucket: %w", err)
	}
	if !ok {
		err = client.MakeBucket(ctx, bucketName, miniogo.MakeBucketOptions{})
		if err != nil {
			return fmt.Errorf("create bucket: %w", err)
		}
	}
	return nil
}
